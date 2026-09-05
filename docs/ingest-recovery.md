# Feed 1 Fix / Recovery

`POST /api/v1/control/ingest/fix` requires the existing
`X-OpenIRL-Control-Token`. The body must be empty or `{}`; clients cannot choose
an input, scene, action or URL. OBS credentials remain backend-only. Dashboard
binding, Feed 1 publisher authentication, and firewall guidance are unchanged.

Set `OBS_INGEST_SOURCE` to the exact OBS **Media Source** input carrying Feed 1
(`ffmpeg_source`). Blank disables Fix. This is independent of
`OBS_INGEST_AUDIO_SOURCE`; both may name the same input. Recovery never changes
mute state or input settings. Browser/VLC sources are unsupported in this phase.

## Contract

Checks include backend responsiveness; stats freshness (at most five seconds),
Feed 1 identity/path, connected state and positive bitrate; MediaMTX reachability
inferred from error-free fresh metrics; HLS playlist availability; OBS API
capabilities; exact input existence, media state and activity; current program
scene and stream state. MediaMTX is **not** directly probed through its admin API.
The bridge can report fresh health even after a metrics error, so recovery also
requires an error-free feed sample. Responses contain sanitized checks, never
raw OBS errors, source settings or upstream credentials.

Only an active, showing `ffmpeg_source` reporting `OBS_MEDIA_STATE_ERROR` can be
restarted, and only while the current scene is already `Live` and Feed 1 is
healthy. Guards are repeated immediately before writing. Recovery uses
[`TriggerMediaInputAction` with `OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART`](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md#triggermediainputaction).
There is no settings rewrite or scene-toggle fallback. Playing inputs are left
alone; paused, stopped, ended, inactive and unknown inputs fail closed because
these may reflect operator intent. A live source that looks frozen but reports
PLAYING cannot be diagnosed reliably here and is not restarted.

Recovery never selects Live (or any scene), starts/stops output, modifies NOALBS,
or restarts containers, services, processes or the host. BRB, Low Bitrate and
custom/privacy scenes block recovery even when the publisher is healthy. There
is no reliable manual-override signal integration, so automatic return to Live
is intentionally omitted. NOALBS/operator scene changes remain authoritative.
OBS has no atomic compare-scene-and-restart API: a scene change can race the
final request, but recovery never switches it back or enables a hidden source.

The backend allows one recovery at a time and a minimum 15-second interval
between attempts (in-memory; resets on dashboard restart). It verifies OBS
PLAYING, fresh healthy telemetry and HLS after an accepted restart, polling up
to three times. HLS can take longer: an unconfirmed result is failed, not a claim
of recovery. A playlist response and OBS PLAYING do not prove decoded video,
audio or outbound delivery. Inspect the preview/output. The HLS proxy has no
server-side player cache to reset; an HLS-only failure gets diagnosis without
service restarts. Browser playback already has automatic retry handling.

Authorized valid requests return HTTP 200 with `state` (`recovered`,
`no_action_needed`, `failed`), `ok`, `summary`, `checks`, `actions` and
`finishedAt` for completed attempts. A rejected concurrent/cooldown attempt has
no `finishedAt` and does not replace the last completed result. Each action
records `attempted`, `success`, and `accepted` when OBS acknowledged it. HTTP
401 means token missing/invalid; HTTP 400 means invalid parameters. A timeout
may have occurred after OBS performed the action; inspect status before retrying.

`GET /api/v1/dashboard/status` includes `recovery.enabled`, `reason`, `working`
and `lastResult`. The Ingest card shows working, recovered, no action needed or
failed with details. The button also requires a token entered in the browser.
No token is returned by status. Results are retained in memory, not durable logs.

## Mini-PC upgrade

After the commit is available on origin/main:

```bash
cd ~/openirl
git status --short
git pull --ff-only origin main
nano .env
```

Add `OBS_INGEST_SOURCE=Feed 1` **only if** `Feed 1` is the exact Media Source name
in OBS. Otherwise use its actual name. Keep existing password hash, control
token, OBS password and audio mapping unchanged. Do not print or share `.env`.

Rebuild only the dashboard; avoid disrupting the live ingest services:

```bash
docker compose --env-file .env -f docker/compose.yaml --profile srtla up --build -d --no-deps dashboard
docker compose --env-file .env -f docker/compose.yaml --profile srtla ps
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/api/v1/dashboard/status | jq '{recovery, audio, program}'
```

Confirm unauthenticated mutation is rejected (expected HTTP 401):

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST http://127.0.0.1:8080/api/v1/control/ingest/fix
```

For a protected test, enter the existing control token at a hidden prompt. It
is not placed in command arguments, shell history or printed output:

```bash
python3 - <<'PY'
import getpass, json, urllib.request
request = urllib.request.Request(
    'http://127.0.0.1:8080/api/v1/control/ingest/fix', data=b'{}',
    headers={'Content-Type': 'application/json',
             'X-OpenIRL-Control-Token': getpass.getpass('Control token: ')})
with urllib.request.urlopen(request, timeout=90) as response:
    print(json.dumps(json.load(response), indent=2))
PY
```

1. **IRL Pro live, OBS playing, scene Live:** enter the token in the dashboard;
   Fix becomes available. Click Fix or run the protected command. Expect
   `no_action_needed`, no actions and no visible interruption. Mute/Unmute should
   retain the existing mapping and state. If the media input actually reports
   ERROR, expect one restart and `recovered` only after verification; otherwise
   `failed` with diagnostic details. Do not break a production feed to force it.
2. **Feed 1 offline:** in a planned test, stop publishing from IRL Pro and wait
   for fresh offline telemetry/NOALBS BRB. Fix should disable with an offline
   reason. The same protected command returns `failed` and an empty action
   list. No scene or service changes. Resume publishing; let NOALBS/operator
   handle the scene. A manually selected BRB/privacy scene continues to block
   Fix even after Feed 1 returns.
3. Wait at least 15 seconds between endpoint tests. A cooldown response is not
   a diagnosis. A missing mapping/disconnected OBS disables Fix with a reason.

Automated validation: `npm run check` (backend and frontend behavior checks)
and `python3 -m unittest discover -s test -p '*_test.py'`. Tests use mocked OBS,
telemetry and browser DOM; real mini-PC/IRL Pro verification is still required.
