// Feed 1 recovery deliberately never writes scenes, settings, mute state or services.
const PLAYING = "OBS_MEDIA_STATE_PLAYING";
const ERROR = "OBS_MEDIA_STATE_ERROR";
const RESTART = "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART";
const requiredRequests = ["GetInputList", "GetMediaInputStatus", "GetSourceActive", "GetCurrentProgramScene", "GetStreamStatus", "TriggerMediaInputAction"];

export class IngestRecovery {
  constructor({ obs, source, feedId, telemetry, preview, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    Object.assign(this, { obs, source, feedId, telemetry, preview, now, wait });
    this.busy = false;
    this.lastAttempt = null;
    this.lastResult = null;
  }

  async diagnose() {
    const startedAt = this.now();
    const checks = [{ id: "backend", ok: true, detail: "Dashboard backend responding" }];
    const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });
    let sampleTimestamp = 0;
    let feedHealthy = false, previewHealthy = false, mediaState = null, sceneSafe = false, inputSafe = false;
    try {
      const { feed, health } = await this.telemetry();
      sampleTimestamp = feed.timestamp;
      const age = this.now() - feed.timestamp;
      const fresh = Number.isFinite(age) && feed.timestamp > 0 && age >= 0 && age <= 5000;
      add("stats", fresh && health.status === "ok", fresh ? "Stats sample is fresh" : "Stats sample is missing or stale");
      const reachable = fresh && health.upstream === "fresh" && !feed.error;
      add("mediamtx", reachable, "MediaMTX reachability inferred from fresh, error-free metrics; no direct API probe");
      feedHealthy = reachable && health.status === "ok" && feed.feed === this.feedId() && feed.streamId === `publish/live/${this.feedId()}` && feed.connected === true && feed.bitrate > 0;
      add("feed", feedHealthy, feedHealthy ? "Feed 1 path ready with incoming bitrate" : "Feed 1 offline, mismatched, or not receiving data");
    } catch {
      for (const id of ["stats", "mediamtx", "feed"]) add(id, false, "Feed telemetry unavailable; no recovery writes allowed");
    }
    try { const preview = await this.preview(); previewHealthy = preview.available === true && !preview.stale; } catch { /* sanitized below */ }
    add("preview", previewHealthy, previewHealthy ? "Ingest preview available (does not verify OBS output)" : "Ingest preview unavailable or stale; check publisher and MediaMTX");
    try {
      const version = await this.obs.request("GetVersion");
      const supported = requiredRequests.every(name => version.availableRequests?.includes(name));
      add("obs", supported, supported ? "OBS connected and media recovery API supported" : "Required OBS recovery requests unavailable");
      if (!supported) throw new Error();
      const inputName = this.source();
      const { inputs } = await this.obs.request("GetInputList");
      inputSafe = Boolean(inputName) && inputs?.some(input => input.inputName === inputName && input.inputKind === "ffmpeg_source");
      if (!inputSafe) throw new Error();
      const media = await this.obs.request("GetMediaInputStatus", { inputName });
      const active = await this.obs.request("GetSourceActive", { sourceName: inputName });
      mediaState = media.mediaState;
      inputSafe = active.videoActive === true && active.videoShowing === true && [PLAYING, ERROR].includes(mediaState);
      add("input", inputSafe, inputSafe ? (mediaState === ERROR ? "Configured media input reports a playback error" : "Configured media input is playing") : "Input inactive, paused, stopped, or state unsupported; preserve operator intent");
      const program = await this.obs.request("GetCurrentProgramScene");
      const stream = await this.obs.request("GetStreamStatus");
      sceneSafe = program.currentProgramSceneName === "Live";
      add("program", sceneSafe, sceneSafe ? `Live scene selected; output ${stream.outputActive ? "streaming" : "stopped"}; scenes will not be changed` : "BRB, privacy, or other scene selected; recovery blocked");
    } catch {
      for (const id of ["obs", "input", "program"]) if (!checks.some(check => check.id === id)) add(id, false, id === "input" ? "Set OBS_INGEST_SOURCE to an existing Feed 1 Media Source; query must succeed" : "OBS state could not be safely verified");
    }
    // Slow OBS queries must not authorize a write using an aged telemetry snapshot.
    if (this.now() - startedAt > 5000 || (feedHealthy && this.now() - sampleTimestamp > 5000)) {
      feedHealthy = false;
      add("diagnosis_age", false, "Diagnosis took too long; refresh before recovery");
    }
    const enabled = feedHealthy && inputSafe && sceneSafe && checks.find(check => check.id === "obs")?.ok;
    const reason = enabled ? "Diagnose Feed 1; restart only a media input reporting an error" : checks.find(check => !check.ok && check.id !== "preview")?.detail ?? "Recovery unavailable";
    return { enabled: Boolean(enabled), reason, checks, mediaState, previewHealthy };
  }

  async status() {
    const diagnosis = await this.diagnose();
    const cooling = this.lastAttempt !== null && this.now() - this.lastAttempt < 15000;
    return { enabled: diagnosis.enabled && !this.busy && !cooling, reason: this.busy ? "Recovery is working" : cooling ? "Wait 15 seconds between recovery attempts" : diagnosis.reason, working: this.busy, lastResult: this.lastResult };
  }

  async run() {
    const result = { state: "failed", ok: false, summary: "Recovery unavailable", checks: [], actions: [] };
    if (this.busy || (this.lastAttempt !== null && this.now() - this.lastAttempt < 15000)) return { ...result, summary: "Recovery already running or cooling down; wait 15 seconds" };
    this.busy = true;
    this.lastAttempt = this.now();
    const finish = (state, summary) => {
      Object.assign(result, { state, ok: state !== "failed", summary, finishedAt: this.now() });
      this.lastResult = result;
      return result;
    };
    try {
      let diagnosis = await this.diagnose();
      result.checks = diagnosis.checks;
      if (!diagnosis.enabled) return finish("failed", diagnosis.reason);
      if (diagnosis.mediaState === PLAYING) return finish(diagnosis.previewHealthy ? "no_action_needed" : "failed", diagnosis.previewHealthy ? "Feed 1 is playing; no action needed" : "OBS is playing but ingest preview is unavailable or stale; no safe server repair available");
      // Repeat all guards immediately before the only mutation; scene ownership remains with NOALBS/operator.
      diagnosis = await this.diagnose();
      result.checks.push(...diagnosis.checks.map(check => ({ ...check, phase: "before_action" })));
      if (!diagnosis.enabled || diagnosis.mediaState !== ERROR) return finish("failed", "State changed before recovery; no action attempted");
      const action = { id: "restart_media_input", attempted: true, success: false };
      result.actions.push(action);
      await this.obs.request("TriggerMediaInputAction", { inputName: this.source(), mediaAction: RESTART });
      action.accepted = true;
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.wait(500);
        const after = await this.diagnose();
        result.checks.push(...after.checks.map(check => ({ ...check, phase: `verify_${attempt + 1}` })));
        if (after.enabled && after.mediaState === PLAYING && after.previewHealthy) {
          action.success = true;
          return finish("recovered", "Feed 1 media input restarted; OBS playing and ingest preview available");
        }
        if (!after.enabled) break;
      }
      return finish("failed", "Restart accepted but recovery could not be confirmed; inspect OBS and publisher before retrying");
    } catch {
      return finish("failed", "OBS recovery failed or timed out; outcome uncertain, inspect source before retrying");
    } finally { this.busy = false; }
  }
}
