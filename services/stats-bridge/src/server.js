import http from "node:http";
import { WebSocketServer } from "ws";
import { FeedTracker, findSample, parsePrometheus } from "./metrics.js";

const settings = {
  port: readPositiveInteger("PORT", 9090),
  metricsUrl:
    process.env.MEDIAMTX_METRICS_URL ?? "http://mediamtx:9998/metrics",
  feedId: process.env.FEED_ID ?? "feed-1",
  mediaPath: process.env.MEDIA_PATH ?? "live/feed-1",
  pollIntervalMs: readPositiveInteger("POLL_INTERVAL_MS", 1000),
  staleAfterMs: readPositiveInteger("STALE_AFTER_MS", 5000),
};

const tracker = new FeedTracker();
let state = {
  type: "stats",
  timestamp: 0,
  streamId: `publish/${settings.mediaPath}`,
  feed: settings.feedId,
  bitrate: 0,
  packetLoss: 0,
  rtt: 0,
  connected: false,
  error: "waiting for first MediaMTX sample",
};

function readPositiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/healthz") {
    const fresh =
      state.timestamp > 0 && Date.now() - state.timestamp <= settings.staleAfterMs;
    sendJson(response, fresh ? 200 : 503, {
      status: fresh ? "ok" : "degraded",
      upstream: fresh ? "fresh" : "stale",
      feed: settings.feedId,
      lastSampleAt: state.timestamp || null,
    });
    return;
  }

  if (
    request.method === "GET" &&
    url.pathname === `/api/v1/feeds/${settings.feedId}`
  ) {
    sendJson(response, 200, state);
    return;
  }

  sendJson(response, 404, { error: "not found" });
});

const sockets = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const requestedFeed = url.searchParams.get("feed");

  if (
    url.pathname !== "/ws-stats" ||
    (requestedFeed && requestedFeed !== settings.feedId)
  ) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  sockets.handleUpgrade(request, socket, head, (client) => {
    sockets.emit("connection", client);
  });
});

sockets.on("connection", (client) => {
  client.send(JSON.stringify(state));
});

function broadcast(nextState) {
  const message = JSON.stringify(nextState);
  for (const client of sockets.clients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

async function poll() {
  const timestamp = Date.now();

  try {
    const response = await fetch(settings.metricsUrl, {
      signal: AbortSignal.timeout(Math.min(settings.pollIntervalMs, 5000)),
    });
    if (!response.ok) throw new Error(`MediaMTX returned HTTP ${response.status}`);

    const samples = parsePrometheus(await response.text());
    const path = findSample(samples, "paths", {
      name: settings.mediaPath,
      state: "ready",
    });
    const byteCounter = findSample(samples, "paths_inbound_bytes", {
      name: settings.mediaPath,
      state: "ready",
    });
    const normalized = tracker.sample({
      bytes: byteCounter?.value ?? 0,
      connected: path?.value === 1,
      timestamp,
    });

    state = {
      type: "stats",
      timestamp,
      streamId: `publish/${settings.mediaPath}`,
      feed: settings.feedId,
      bitrate: normalized.bitrate,
      packetLoss: 0,
      rtt: 0,
      connected: normalized.connected,
    };
  } catch (error) {
    state = {
      ...state,
      timestamp,
      bitrate: 0,
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  broadcast(state);
}

const timer = setInterval(poll, settings.pollIntervalMs);
timer.unref();
await poll();

server.listen(settings.port, "0.0.0.0", () => {
  console.log(
    `stats bridge listening on :${settings.port} for ${settings.mediaPath}`,
  );
});

function shutdown() {
  clearInterval(timer);
  sockets.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
