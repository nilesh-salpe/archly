// A minimal, hand-written YAML reader/writer scoped to exactly what this
// app's schema needs: nested block mappings ("key: value"), block sequences
// of mappings ("- key: value" + aligned continuation lines), plain/quoted
// string scalars, numbers, true/false/null, and "#" comments.
//
// NOT supported (by design, to keep this small and dependency-free): flow
// style ({a: 1}, [1, 2]), multi-line block scalars (| or >), anchors/aliases,
// tags, and multiple documents. Hand-edited pattern/diagram files should
// stick to the style this module itself emits.

function ymlStripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}

function ymlFindColon(text) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ':' && !inSingle && !inDouble) {
      if (i === text.length - 1 || text[i + 1] === ' ') return i;
    }
  }
  return -1;
}

function ymlParseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try {
      return s.startsWith('"') ? JSON.parse(s) : s.slice(1, -1).replace(/''/g, "'");
    } catch (e) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function parseYAML(text) {
  const lines = [];
  for (const raw of String(text).split(/\r\n|\n/)) {
    const stripped = ymlStripComment(raw).replace(/\s+$/, '');
    if (stripped.trim() === '') continue;
    const indent = stripped.match(/^ */)[0].length;
    lines.push({ indent, text: stripped.slice(indent) });
  }

  let i = 0;

  function parseValueBlock(minIndent) {
    if (i >= lines.length || lines[i].indent < minIndent) return null;
    if (lines[i].text === '-' || lines[i].text.startsWith('- ')) return parseSeq(lines[i].indent);
    return parseMap(lines[i].indent);
  }

  function parseSeq(indent) {
    const arr = [];
    while (i < lines.length && lines[i].indent === indent && (lines[i].text === '-' || lines[i].text.startsWith('- '))) {
      const rest = lines[i].text === '-' ? '' : lines[i].text.slice(2);
      i++;
      if (rest === '') {
        arr.push(parseValueBlock(indent + 1));
        continue;
      }
      const colonIdx = ymlFindColon(rest);
      if (colonIdx === -1) {
        arr.push(ymlParseScalar(rest));
        continue;
      }
      const obj = {};
      const key = rest.slice(0, colonIdx).trim();
      const value = rest.slice(colonIdx + 1).trim();
      obj[key] = value === '' ? parseValueBlock(indent + 2) : ymlParseScalar(value);
      parseMapInto(obj, indent + 2);
      arr.push(obj);
    }
    return arr;
  }

  function parseMap(indent) {
    const obj = {};
    parseMapInto(obj, indent);
    return obj;
  }

  function parseMapInto(obj, indent) {
    while (i < lines.length && lines[i].indent === indent && lines[i].text !== '-' && !lines[i].text.startsWith('- ')) {
      const { text } = lines[i];
      const colonIdx = ymlFindColon(text);
      if (colonIdx === -1) {
        i++; // malformed line — skip rather than fail the whole parse
        continue;
      }
      const key = text.slice(0, colonIdx).trim();
      const value = text.slice(colonIdx + 1).trim();
      i++;
      obj[key] = value === '' ? parseValueBlock(indent + 2) : ymlParseScalar(value);
    }
  }

  return parseValueBlock(0) || {};
}

function ymlNeedsQuoting(str) {
  if (str === '') return true;
  // A newline (or tab) in a scalar — labels are multi-line now — has to be
  // written double-quoted so JSON.stringify escapes it; emitting it raw would
  // split the value across lines and corrupt the document.
  if (/[\n\r\t]/.test(str)) return true;
  if (/^\s|\s$/.test(str)) return true;
  if (/^(true|false|null|~)$/i.test(str)) return true;
  if (/^-?\d+(\.\d+)?$/.test(str)) return true;
  if (/[:#]/.test(str)) return true;
  if (/^[-?[\]{}&*!|>'"%@`,]/.test(str)) return true;
  return false;
}

function ymlScalarToText(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const str = String(value);
  return ymlNeedsQuoting(str) ? JSON.stringify(str) : str;
}

function ymlWriteMapping(obj, indent, lines) {
  const pad = ' '.repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      ymlWriteSequence(value, indent + 2, lines);
    } else if (value !== null && typeof value === 'object') {
      lines.push(`${pad}${key}:`);
      ymlWriteMapping(value, indent + 2, lines);
    } else {
      lines.push(`${pad}${key}: ${ymlScalarToText(value)}`);
    }
  }
}

function ymlWriteSequence(arr, indent, lines) {
  const pad = ' '.repeat(indent);
  for (const item of arr) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const entries = Object.entries(item).filter(([, v]) => v !== undefined);
      if (entries.length === 0) {
        lines.push(`${pad}- {}`);
        continue;
      }
      entries.forEach(([k, v], idx) => {
        const linePrefix = idx === 0 ? `${pad}- ` : `${pad}  `;
        if (Array.isArray(v)) {
          lines.push(`${linePrefix}${k}:`);
          ymlWriteSequence(v, indent + 4, lines);
        } else if (v !== null && typeof v === 'object') {
          lines.push(`${linePrefix}${k}:`);
          ymlWriteMapping(v, indent + 4, lines);
        } else {
          lines.push(`${linePrefix}${k}: ${ymlScalarToText(v)}`);
        }
      });
    } else {
      lines.push(`${pad}- ${ymlScalarToText(item)}`);
    }
  }
}

function stringifyYAML(obj) {
  const lines = [];
  ymlWriteMapping(obj, 0, lines);
  return lines.join('\n') + '\n';
}
