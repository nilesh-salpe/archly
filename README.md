# Archly

A drag-and-drop cloud architecture diagram tool, built as a static page with
no build step, meant to run on GitHub Pages.

## Features

- **Component palette** — Region, Availability Zone, VPC, Subnet, DNS, CDN,
  Load Balancer, API Gateway, WAF, Service Instances, Containers, Lambda,
  Auto Scaling Groups, RDS, Cassandra, MongoDB, Neo4j, Vector DB, S3, Redis,
  Kafka, clients, and security components.
- **Drag & drop** components onto the canvas, drag to reposition, resize
  container boundaries. Dragging snaps to a grid and to alignment with other
  nodes (hold Alt to move freely); arrow keys nudge the selection.
- **Multi-select** — shift-click or drag a selection box over multiple nodes
  to move, copy, layer, or delete them together.
- **Undo / redo** for every edit (Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z).
- **Zoom & pan** — Ctrl/Cmd+scroll to zoom under the cursor, or use the
  toolbar's +/−/Fit controls; rulers stay accurate at any zoom level.
- **Numbered flow arrows** — drag from *any point* on a node's border (not
  just fixed dots) to another node to draw an arrow; click its number badge
  to edit the request-flow order.
- **Shapeable arrows** — drag a curved arrow's line to bend it; drag a
  right-angle (orthogonal) arrow's line to slide its elbow. Double-click
  adds an extra elbow beyond the default pair, or removes a bend.
- **Play the request flow** — animates a dot along each arrow in numbered
  order, pulsing the active nodes. Pause / Reset / Speed controls included.
- **Simulated latency & cost** (View ▾) — a per-node estimate badge and an
  end-to-end latency + hourly cost summary, computed from practical
  category-level defaults (editable per node by hand-editing the diagram
  for now).
- **Pattern library** — 14 pre-built diagrams (3-Tier Web App, Microservices
  + API Gateway, Cache-Aside, ML, GenAI, RAG, Event-Driven/Pub-Sub, Async Job
  Queue, Serverless, Batch/ETL, Multi-Region DR, Saga, Multi-Agent GenAI,
  Secured Public API), previewed with thumbnails in the Patterns dropdown.
- **Export** the diagram as a PNG, a plain or self-playing animated SVG, or
  as hand-editable YAML.
- Work auto-saves to the browser's local storage.

## Running locally

No build step is required — it's plain HTML/CSS/JS. Serve the folder with any
static file server, e.g.:

```
python3 -m http.server 8000
```

then open `http://localhost:8000`.

## Deploying to GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repo's Settings → Pages, set "Deploy from a branch", branch `main`,
   folder `/ (root)`.
3. The site will be published at `https://<user>.github.io/<repo>/`.
