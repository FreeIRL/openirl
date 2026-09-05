import { createHash, randomUUID } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("base64");

export function obsAuthentication(password, salt, challenge) {
  return hash(`${hash(`${password}${salt}`)}${challenge}`);
}

export class ObsClient {
  constructor({ url, password, WebSocketImpl = globalThis.WebSocket, reconnectMs = 3000 }) {
    this.url = url;
    this.password = password;
    this.WebSocketImpl = WebSocketImpl;
    this.reconnectMs = reconnectMs;
    this.socket = null;
    this.timer = null;
    this.pending = new Map();
    this.stopped = false;
    this.state = { connected: false, scene: null, streaming: false, error: null, updatedAt: null };
  }

  snapshot() { return { ...this.state }; }

  connect() {
    if (!this.url || !this.password || this.socket || !this.WebSocketImpl) return;
    this.stopped = false;
    try {
      const socket = new this.WebSocketImpl(this.url);
      this.socket = socket;
      socket.addEventListener("message", (event) => this.#message(event.data));
      socket.addEventListener("close", () => this.#disconnected("OBS WebSocket disconnected"));
      socket.addEventListener("error", () => { this.state.error = "OBS WebSocket connection failed"; });
    } catch (error) { this.#disconnected(error instanceof Error ? error.message : String(error)); }
  }

  close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  async request(requestType, requestData) {
    if (!this.state.connected || !this.socket) throw new Error("OBS is not connected");
    const requestId = randomUUID();
    const result = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(requestId); reject(new Error("OBS request timed out")); }, 5000);
      this.pending.set(requestId, { resolve, reject, timeout });
    });
    this.#send({ op: 6, d: { requestType, requestId, ...(requestData ? { requestData } : {}) } });
    return result;
  }

  async setScene(sceneName) {
    await this.request("SetCurrentProgramScene", { sceneName });
  }

  async ingestAudioStatus(inputName) {
    if (!this.state.connected) return { healthy: false, muted: null, reason: "OBS is disconnected" };
    if (!inputName) return { healthy: false, muted: null, reason: "Set OBS_INGEST_AUDIO_SOURCE to the exact Feed 1 OBS input name" };
    try {
      const { inputMuted } = await this.request("GetInputMute", { inputName });
      if (typeof inputMuted !== "boolean" || !this.state.connected) throw new Error();
      return { healthy: true, muted: inputMuted, reason: inputMuted ? "Main ingest audio is muted" : "Main ingest audio is unmuted" };
    } catch {
      return { healthy: false, muted: null, reason: "Configured OBS audio input is missing, has no audio, or could not be queried" };
    }
  }

  async setIngestMuted(inputName, muted) {
    if (typeof muted !== "boolean") throw new Error("Mute state must be boolean");
    const before = await this.ingestAudioStatus(inputName);
    if (!before.healthy) throw new Error(before.reason);
    // Never toggle or accept a browser-selected input. Revalidate before writing.
    try { await this.request("SetInputMute", { inputName, inputMuted: muted }); }
    catch { throw new Error("OBS could not change the configured ingest audio input"); }
    const after = await this.ingestAudioStatus(inputName);
    if (!after.healthy || after.muted !== muted) throw new Error("OBS mute state could not be confirmed; refresh status before retrying");
    return after;
  }

  async startStream() { await this.request("StartStream"); }
  async stopStream() { await this.request("StopStream"); }

  #send(message) { this.socket?.send(JSON.stringify(message)); }

  async #message(raw) {
    let message;
    try { message = JSON.parse(typeof raw === "string" ? raw : await raw.text()); } catch { return; }
    const { op, d = {} } = message;
    if (op === 0) {
      const authentication = d.authentication
        ? obsAuthentication(this.password, d.authentication.salt, d.authentication.challenge)
        : undefined;
      this.#send({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 69, ...(authentication ? { authentication } : {}) } });
    } else if (op === 2) {
      this.state = { ...this.state, connected: true, error: null, updatedAt: Date.now() };
      Promise.all([this.request("GetCurrentProgramScene"), this.request("GetStreamStatus")])
        .then(([scene, stream]) => {
          this.state.scene = scene.currentProgramSceneName ?? null;
          this.state.streaming = Boolean(stream.outputActive);
          this.state.updatedAt = Date.now();
        }).catch((error) => { this.state.error = error.message; });
    } else if (op === 5) {
      if (d.eventType === "CurrentProgramSceneChanged") this.state.scene = d.eventData?.sceneName ?? null;
      if (d.eventType === "StreamStateChanged") this.state.streaming = Boolean(d.eventData?.outputActive);
      this.state.updatedAt = Date.now();
    } else if (op === 7) {
      const pending = this.pending.get(d.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout); this.pending.delete(d.requestId);
      if (d.requestStatus?.result) pending.resolve(d.responseData ?? {});
      else pending.reject(new Error(d.requestStatus?.comment ?? `OBS rejected ${d.requestType}`));
    }
  }

  #disconnected(error) {
    if (this.socket) this.socket = null;
    this.state = { ...this.state, connected: false, scene: null, streaming: false, error, updatedAt: Date.now() };
    for (const { reject, timeout } of this.pending.values()) { clearTimeout(timeout); reject(new Error(error)); }
    this.pending.clear();
    if (!this.stopped && !this.timer) this.timer = setTimeout(() => { this.timer = null; this.connect(); }, this.reconnectMs);
  }
}
