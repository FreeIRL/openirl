import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { ObsClient } from "./obs-client.js";

export const settings = {
  port: Number.parseInt(process.env.PORT ?? "8080", 10),
  statsBridgeUrl: process.env.STATS_BRIDGE_URL ?? "http://stats-bridge:9090",
  feedId: process.env.FEED_ID ?? "feed-1",
  bindHost: process.env.BIND_HOST ?? "127.0.0.1",
  controlToken: process.env.OPENIRL_CONTROL_TOKEN ?? "",
  obsUrl: process.env.OBS_WEBSOCKET_URL ?? "ws://127.0.0.1:4455",
  obsPassword: process.env.OBS_WEBSOCKET_PASSWORD ?? "",
};

export const allowedScenes = new Set(["Live", "Low Bitrate", "BRB"]);
export const obsClient = new ObsClient({ url: settings.obsUrl, password: settings.obsPassword });

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

function authorized(request) {
  const supplied = request.headers?.["x-openirl-control-token"] ?? "";
  if (!settings.controlToken || !supplied) return false;
  const expected = Buffer.from(settings.controlToken); const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) throw new Error("request body too large");
  }
  return body ? JSON.parse(body) : {};
}

async function control(request, response, pathname) {
  if (!authorized(request)) return json(response, 401, { error: "valid control token required" });
  if (!obsClient.snapshot().connected) return json(response, 503, { error: "OBS is not connected" });
  try {
    if (pathname === "/api/v1/control/scene") {
      const { scene } = await readJson(request);
      if (!allowedScenes.has(scene)) return json(response, 400, { error: "scene must be Live, Low Bitrate, or BRB" });
      await obsClient.setScene(scene);
    } else if (pathname === "/api/v1/control/stream/start") await obsClient.startStream();
    else if (pathname === "/api/v1/control/stream/stop") await obsClient.stopStream();
    else return json(response, 404, { error: "not found" });
    return json(response, 200, { ok: true });
  } catch (error) { return json(response, 502, { error: error instanceof Error ? error.message : String(error) }); }
}

export async function dashboardStatus() {
  const checkedAt = Date.now();
  const obs = obsClient.snapshot();
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
        obs: { state: obs.connected ? "healthy" : "offline", source: "live", note: obs.error ?? (obs.connected ? "OBS WebSocket connected" : "OBS WebSocket disconnected") },
        noalbs: { state: "unknown", source: "unavailable", note: "NOALBS health endpoint not connected" },
        srtla: { state: "unknown", source: "unavailable", note: "Per-link SRTLA telemetry is not implemented" },
      },
      controls: { enabled: obs.connected && Boolean(settings.controlToken), reason: !settings.controlToken ? "Set OPENIRL_CONTROL_TOKEN to enable controls" : obs.connected ? "Enter the control token to operate OBS" : "OBS is disconnected" },
      program: { scene: obs.scene, state: obs.connected ? (obs.streaming ? "Live" : "Stopped") : null, streaming: obs.streaming, previewUrl: null },
      links: null,
    };
  } catch (error) {
    return {
      checkedAt,
      feed: { feed: settings.feedId, connected: false, bitrate: 0, timestamp: 0, error: error instanceof Error ? error.message : String(error) },
      services: {
        statsBridge: { state: "offline", source: "live", note: "Dashboard cannot reach stats-bridge" },
        mediaMtx: { state: "unknown", source: "unavailable" },
        obs: { state: obs.connected ? "healthy" : "offline", source: "live", note: obs.error ?? undefined },
        noalbs: { state: "unknown", source: "unavailable" },
        srtla: { state: "unknown", source: "unavailable", note: "Per-link SRTLA telemetry is not implemented" },
      },
      controls: { enabled: obs.connected && Boolean(settings.controlToken), reason: !settings.controlToken ? "Set OPENIRL_CONTROL_TOKEN to enable controls" : obs.connected ? "Enter the control token to operate OBS" : "OBS is disconnected" },
      program: { scene: obs.scene, state: obs.connected ? (obs.streaming ? "Live" : "Stopped") : null, streaming: obs.streaming, previewUrl: null },
      links: null,
    };
  }
}

export async function handleRequest(request, response) {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/healthz") return json(response, 200, { status: "ok" });
    if (request.method === "GET" && url.pathname === "/api/v1/dashboard/status") return json(response, 200, await dashboardStatus());
    if (request.method === "POST" && url.pathname.startsWith("/api/v1/control/")) return control(request, response, url.pathname);
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
  obsClient.connect();
  createServer().listen(settings.port, settings.bindHost, () => console.log(`OpenIRL dashboard listening on ${settings.bindHost}:${settings.port}`));
}
