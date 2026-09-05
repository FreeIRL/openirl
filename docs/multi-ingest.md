# Dynamic multi-ingest migration

This opt-in overlay adds a persistent feed registry, protocol authentication, feed snapshots and one profile-aware scene controller. The base Compose stack continues to support the existing single-feed/NOALBS deployment. Do not replace a running production stack without first rehearsing this migration. OBS Cloud is outside this change.

## Before changing the server

1. Back up `.env`, the deployed MediaMTX configuration, NOALBS configuration and the OBS scene collection. Preserve `FEED_1_PASSWORD_HASH`, `OPENIRL_CONTROL_TOKEN`, both explicit OBS source variables and the OBS password. Do not print or copy those values into issue reports.
2. Use Linux with host networking and Docker Compose **2.24.4 or newer**. The overlay requires `!reset` and `!override`. Rebuild both dashboard (now includes FFmpeg) and stats-bridge (now honors loopback binding). Do not reuse the old stats-bridge image with host networking. Keep all existing Cloudflare Access policies and the tunnel overlay.
3. Obtain a certificate for the **ingest** hostname. Set `OPENIRL_INGEST_CERT_DIR` to an absolute directory containing `server.crt` (full chain) and `server.key`. MediaMTX reads them; neither is served by the dashboard. Certificate renewal remains the server operator's existing responsibility; reload/restart MediaMTX after renewal in a maintenance window.
4. Set `OPENIRL_INGEST_HOST` to the DNS-only ingest hostname/IP. A domain does not replace port forwarding. SRTLA continues to use UDP 5000. For direct SRT, set `OPENIRL_SRT_BIND=0.0.0.0:8890` and forward UDP 8890. For RTMPS, set `OPENIRL_RTMPS_BIND=0.0.0.0:1936` and forward TCP 1936. RTMP is optional: `OPENIRL_RTMP_BIND=0.0.0.0:1935` and TCP 1935. Keep the default port numbers; connection details currently generate these standard ports. Do not expose 8080, 8081, 9997, 9998, or 4455.
5. **Disable NOALBS bitrate scene switching before setting `OPENIRL_AUTOMATION_OWNER=openirl`.** Set `switcher.bitrateSwitcherEnabled=false` in its deployed configuration and restart that existing instance, or stop that instance. Keep its other integration/configuration intact. The program cannot detect independently launched NOALBS processes. With owner `noalbs` (default), the new controller never writes scenes and Take Live refuses to run. There must be exactly one scene automation owner.

Run from the repository root, retaining explicit `.env` loading and your existing Cloudflare overlay:

```sh
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.multi-ingest.yaml -f docker/compose.cloudflare.yaml --profile srtla config --quiet
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.multi-ingest.yaml -f docker/compose.cloudflare.yaml --profile srtla build dashboard stats-bridge
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.multi-ingest.yaml -f docker/compose.cloudflare.yaml --profile srtla up -d
```

If you use the HTTPS overlay instead of Cloudflare, retain that overlay instead. Migration restarts ingest services; schedule it off-air. OBS itself and its outbound streaming settings are untouched. A successful config check is not an end-to-end streaming test.

## Migration and operator workflow

On the first start, `/data/registry.json` imports the existing `feed-1` ID/path/username/password hash and a `Live` / `Low Bitrate` / `BRB` profile. The original secret is never reconstructed or silently changed. Keep using the old encoder settings. The registry lives in the `multi-ingest-data` named volume, with mode 0600 and atomic writes. Never use `down -v` during an upgrade. Back up this volume privately: generated credentials are retained there so the operator can retrieve connection details later. Corrupt/incompatible registries fail startup instead of regenerating credentials.

Open **Feeds and production profiles** in the dashboard and enter the existing control token. Add any number of feeds appropriate for your server resources. The mobile and encoder presets only preselect a protocol; every feed may choose any combination. Renaming never changes its permanent ID or ingest path. Details are fetched only through the token-protected endpoint, are not included in normal telemetry, and are not saved in browser storage.

Use each feed's local `rtmp://127.0.0.1:1935/live/FEED_ID` as its OBS Media Source. Construct OBS scenes with one or more of those sources. Add a production profile referencing the same feed IDs, enter the exact normal/low/offline scene names and minimum healthy feed count, then **Take Live**. The controller checks that all three scenes exist. It changes the scene, never restarts the outbound stream. OBS source placement and scene construction remain operator actions.

A selected profile is normal when at least its minimum count is ONLINE. If the count is insufficient but enough feeds remain ONLINE or DEGRADED, it is low. Otherwise it is offline/BRB. Unrelated feeds never contribute. Default feed thresholds preserve NOALBS's 1200 kbps low and 200 kbps offline values. Automatic transitions must persist for three seconds; Take Live applies current health immediately. Manually choosing another OBS scene outside the profile, or using the existing manual scene buttons, pauses automation until Take Live. A selected profile cannot be edited/deleted; select another first.

Disable a feed before changing its protocols, rotating credentials or deleting it. Disabling requires confirmation and revokes new publishing immediately, then kicks its publisher. If MediaMTX cannot be reached, the feed remains disabled and the controller retries disconnecting it; the operation reports an error. Rotation/delete refuse to proceed when MediaMTX cannot confirm/disconnect the existing path. Deleting a feed also requires removing all profile references. Rotation invalidates the previous secret permanently. Re-enable and update the encoder with the new details. Concurrent/stale operator writes are rejected using the registry revision.

## Transport and security boundaries

The overlay switches MediaMTX to a **loopback HTTP authentication service** in the dashboard process. An unavailable auth service rejects new publishers. Feed credentials are restricted to their exact path, enabled flag and transport. Public reading is denied; OBS and snapshot reads remain local. The MediaMTX API and metrics skip external auth only because their listeners bind exclusively to loopback. RTSP, WebRTC, MoQ, playback and HLS are disabled in this overlay. The dashboard remains loopback-only behind the existing Cloudflare Access gate; mutations still independently require the control token. OBS credentials never enter frontend responses.

MediaMTX labels both RTMP and RTMPS authentication as `rtmp`. The controller verifies the connection ID against its TLS or plaintext API collection before approving the selected protocol. SRTLA uses the existing receiver's independent connection groups over the shared UDP 5000 listener, with each group forwarded as a separate SRT connection. Feed credentials/stream IDs identify the destination. No receiver is started per feed.

**SRT transport classification is deployment-specific:** in this host-network topology, the SRTLA receiver forwards from loopback, while direct remote SRT has a remote source IP. Local direct SRT is consequently classified as SRTLA. Do not put a local UDP proxy in front of direct SRT or move the receiver to another host without revising this policy. SRTLA stream ID is presented separately. SRT URLs retain literal stream ID delimiters for FFmpeg compatibility; clients that offer separate stream ID fields should use that value. RTMP(S) uses server plus `FEED_ID?user=...&pass=...` as the stream key.

## Snapshots and idle behavior

The multi-ingest dashboard uses JPEGs, not HLS playback. One short FFmpeg invocation reads the local ingest approximately every 10 seconds, with at most two workers globally, a seven-second timeout, a 2 MiB output bound and 640-pixel width. Refresh Now shares the same cooldown/concurrency limits across users. Under load, refresh intervals can be longer. Failed captures and disconnected feeds retain the last successful frame and timestamp; snapshots are memory caches and are not retained after dashboard restarts.

Feeds transition through CONNECTING, ONLINE, DEGRADED, OFFLINE and IDLE. After 60 seconds disconnected, they become IDLE; disabled feeds are immediately IDLE. Disconnected/idle feeds run no snapshot extraction. MediaMTX, the shared SRTLA listener and lightweight metrics polling stay alive for reconnects. OBS source suspension is intentionally not automated because OBS may use a source in an independently managed scene. Configure OBS's source visibility behavior explicitly if desired.

The legacy Feed 1 mute and guarded Fix controls remain bound to their explicit `.env` source mappings. They are not repurposed to arbitrary sources by the new manager. Guarded Fix remains restricted to the legacy Live scene. Per-feed OBS audio/recovery mappings are a follow-up, not part of the dynamic registry operations.

## Validation and rollback

Run `npm ci` and `npm run check`. For the opt-in real transport test, install FFmpeg and OpenSSL, then run:

```sh
OPENIRL_TEST_MEDIAMTX=/absolute/path/to/mediamtx node --test apps/dashboard/test/media-runtime.test.js
```

Use MediaMTX 1.20.1. This test uses temporary credentials/certificates and loopback ports 18081, 19997, 19998, 11935, 11936 and 18890. It tests authentication, RTMPS-only rejection of plaintext publishing, actual snapshot decoding, active publisher revocation and (when FFmpeg includes libsrt) SRT stream ID interoperability. It does not test a phone's bonded SRTLA connection, Cloudflare Access or real OBS scene behavior.

Before going live, verify two simultaneous phones/encoders, minimum-one and minimum-two profile behavior, reconnect after 60 seconds, snapshot timestamps, wrong/cross-feed/rotated credentials, external playback rejection, and cellular dashboard access. Also verify the selected controller is the sole scene writer.

To roll back, stop the overlay stack without deleting volumes, restore the backed-up MediaMTX/NOALBS configuration and `.env`, and start the prior base plus Cloudflare/HTTPS overlays. Re-enable NOALBS scene switching only after the OpenIRL controller is stopped. Newly created feeds are unavailable in the base stack. If you rotated the legacy feed after migration, restore its old encoder credential for the old stack or deliberately migrate its new hash—do not assume the old `.env` was updated by the registry.
