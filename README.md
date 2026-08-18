# System Design Studio

A drag-and-drop cloud architecture diagram tool, built as a static page with
no build step, meant to run on GitHub Pages.

## Features

- **Component palette** — Region, Availability Zone, VPC, Subnet, DNS, CDN,
  Load Balancer, API Gateway, WAF, Service Instances, Containers, Lambda,
  Auto Scaling Groups, RDS, Cassandra, MongoDB, Neo4j, Vector DB, S3, Redis,
  Kafka, clients, and security components.
- **Drag & drop** components onto the canvas, drag to reposition, resize
  container boundaries.
- **Numbered flow arrows** — drag from a node's connector dot to another node
  to draw an arrow; click its number badge to edit the request-flow order.
- **Play the request flow** — animates a dot along each arrow in numbered
  order, pulsing the active nodes. Pause / Reset / Speed controls included.
- **Pattern library** — load pre-built diagrams (3-Tier Web App, Microservices
  + API Gateway, Cache-Aside) that render and auto-play.
- **Export** the diagram as a PNG or SVG image.
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
