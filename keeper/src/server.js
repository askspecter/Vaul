import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Only files the keeper writes: <vault address>-<raffle id>.json
const NAME = /^\/(0x[0-9a-f]{40}-\d+\.json)$/;

/**
 * Serves raffle snapshots read-only with CORS, so a static site (e.g. on Vercel)
 * can load them. Point the site's config.snapshotBaseUrl at this server.
 */
export function serveSnapshots(dir, port, log) {
  createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cache-control", "public, max-age=60");
    const m = req.method === "GET" && NAME.exec(new URL(req.url, "http://x").pathname);
    if (!m) {
      res.writeHead(req.url === "/health" ? 200 : 404).end(req.url === "/health" ? "ok" : "not found");
      return;
    }
    try {
      const body = await readFile(join(dir, m[1]));
      res.writeHead(200, { "content-type": "application/json" }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  }).listen(port, () => log(`serving snapshots from ${dir} on :${port}`));
}
