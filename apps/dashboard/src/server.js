import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const settings = {
  port: Number.parseInt(process.env.PORT ?? "8080", 10),
  statsBridgeUrl: process.env.STATS_BRIDGE_URL ?? "http://stats-bridge:9090",
  feedId: process.env.FEED_ID ?? "feed-1",
};

const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const types = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml" };

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function upstream(path) {
  const response = await fetch(`${settings.statsBridgeUrl}${path}`, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`stats-bridge returned ${response.status}`);
  return response.json();
}

export async function dashboardStatus() {
  const checkedAt = Date.now();
  try {
    const [feed, health] = await Promise.all([
      upstream(`/api/v1/feeds/${encodeURIComponent(settings.feedId)}`),
      upstream("/healthz"),
    ]);
    return {
      checkedAt,
      feed,
      services: {
        statsBridge: { state: health.status === "ok" ? "healthy" : "degraded", source: "live" },
        mediaMtx: { state: health.upstream === "fresh" ? "healthy" : "degraded", source: "inferred", note: "Inferred from fresh MediaMTX metrics" },
        obs: { state: "unknown", source: "unavailable", note: "OBS integration not connected" },
        noalbs: { state: "unknown", source: "unavailable", note: "NOALBS health endpoint not connected" },
        srtla: { state: "unknown", source: "unavailable", note: "Per-link SRTLA telemetry is not implemented" },
      },
      controls: { enabled: false, reason: "Authentication and OBS control backend are not implemented" },
      program: { scene: null, state: null, previewUrl: null },
      links: null,
    };
  } catch (error) {
    return {
      checkedAt,
      feed: { feed: settings.feedId, connected: false, bitrate: 0, timestamp: 0, error: error instanceof Error ? error.message : String(error) },
      services: {
        statsBridge: { state: "offline", source: "live", note: "Dashboard cannot reach stats-bridge" },
        mediaMtx: { state: "unknown", source: "unavailable" },
        obs: { state: "unknown", source: "unavailable" },
        noalbs: { state: "unknown", source: "unavailable" },
        srtla: { state: "unknown", source: "unavailable", note: "Per-link SRTLA telemetry is not implemented" },
      },
      controls: { enabled: false, reason: "Authentication and OBS control backend are not implemented" },
      program: { scene: null, state: null, previewUrl: null },
      links: null,
    };
  }
}

export async function handleRequest(request, response) {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/healthz") return json(response, 200, { status: "ok" });
    if (request.method === "GET" && url.pathname === "/api/v1/dashboard/status") return json(response, 200, await dashboardStatus());
    if (url.pathname.startsWith("/api/") || request.method !== "GET") return json(response, 404, { error: "not found" });

    const requestPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const safePath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
    try {
      const body = await readFile(join(publicDirectory, safePath));
      response.writeHead(200, { "content-type": `${types[extname(safePath)] ?? "application/octet-stream"}; charset=utf-8`, "x-content-type-options": "nosniff" });
      response.end(body);
    } catch {
      json(response, 404, { error: "not found" });
    }
}

export function createServer() {
  return http.createServer(handleRequest);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(settings.port, "0.0.0.0", () => console.log(`OpenIRL dashboard listening on :${settings.port}`));
}
