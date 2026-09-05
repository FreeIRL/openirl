# Operator dashboard

The first responsive operator dashboard is implemented here. Desktop uses an operations-center layout; screens up to 800 px switch to the one-handed mobile control view.

The backend exposes `GET /api/v1/dashboard/status`, connects to OBS WebSocket itself, and keeps the browser away from OBS credentials and port 4455. It reports the current program scene and stream state from OBS events (with an initial state query), so changes made by OBS or NOALBS appear on the next two-second dashboard refresh.

Mutations require `X-OpenIRL-Control-Token` and are restricted to:

- `POST /api/v1/control/scene` with `{"scene":"Live"}`, `Low Bitrate`, or `BRB`
- `POST /api/v1/control/stream/start`
- `POST /api/v1/control/stream/stop`
- `POST /api/v1/control/ingest/mute` and `/api/v1/control/ingest/unmute` (no parameters)

The UI asks for the token and keeps it only in the password field. It confirms before stopping. Mute/Unmute require a healthy `OBS_INGEST_AUDIO_SOURCE` mapping and report confirmed state in the status response’s `audio` object. Fix remains disabled. See [deployment and validation](../../docs/feed-auth-and-audio-upgrade.md).

Run locally from the repository root:

```sh
npm install
STATS_BRIDGE_URL=http://127.0.0.1:9090 \
OBS_WEBSOCKET_PASSWORD='your-obs-password' \
OPENIRL_CONTROL_TOKEN='a-different-random-secret' \
npm start --workspace @openirl/dashboard
```

Open `http://127.0.0.1:8080`. For LAN or Internet access, keep this service loopback-bound and publish it through an authenticated HTTPS reverse proxy or a private VPN; do not change the Compose binding to `0.0.0.0` without an access-control layer.

## Feed 1 Fix / Recovery

See [the recovery contract and mini-PC validation guide](../../docs/ingest-recovery.md). Configure `OBS_INGEST_SOURCE` independently of the audio mapping. Fix only restarts an active Media Source reporting ERROR, with fresh healthy Feed 1 telemetry and the Live scene already selected. It never changes scenes or restarts services.

## Operator pages

The dashboard supports direct links to `/overview`, `/feeds`, `/production`,
`/obs`, `/health` and `/settings`. `/` opens Overview. Mobile navigation uses
Overview, Feeds, Production, Health and More (`/more`), which links to OBS / Stream
and Settings. Browser Back/Forward works without restarting polling or clearing
unsaved feed/profile editors. Reloading clears the in-memory control token.

BRB, mute and confirmed stream stop stay in the sticky emergency bar on every
page. Expand Operator access to enter the token. These buttons share the existing
OBS availability, audio mapping, busy-state and token checks. No separate privacy
command exists; none is invented by this UI. Manual scenes retain the existing
production automation pause behavior, and Take Live resumes OpenIRL automation.

Feeds owns source configuration and authenticated credential details. Production
owns profiles and Take Live. Health shows bitrate, services and the most recent
30 observed changes in each history, held only for this browser session. Missing
SRTLA metrics are explicitly unavailable. Settings shows a public hostname and
control availability, never environment dumps or secret values. Advanced changes
remain server-managed. Existing single-feed installs show an explicit message on
Feeds/Production when dynamic multi-ingest is disabled.

This is a dashboard refactor only: local-SRT HEVC snapshots, MediaMTX auth,
Cloudflare proxying, and automation ownership configuration remain unchanged.
