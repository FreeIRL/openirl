# Phase 1 development walkthrough

This setup has been validated end to end: SRT publisher → MediaMTX → `stats-bridge` → NOALBS → OBS, including automatic transitions between `Live`, `Low Bitrate`, and `BRB` and recovery back to `Live`.

## 1. Start the media and health services

From the repository root:

```sh
docker compose -f docker/compose.yaml up --build
```

The public contribution listeners are SRT on UDP 8890 and RTMP on TCP 1935. The MediaMTX API and metrics ports are container-internal; normalized health is available locally on port 9090. MediaMTX HLS playback uses TCP 8888 but Compose binds it to `127.0.0.1` only.

## 2. Publish a test feed

Publish SRT to:

```text
srt://SERVER_IP:8890?streamid=publish:live/feed-1
```

MediaMTX also accepts the standard SRT stream ID form:

```text
srt://SERVER_IP:8890?streamid=#!::m=publish,r=live/feed-1
```

For a first LAN test, an RTMP publisher can use:

```text
rtmp://SERVER_IP:1935/live/feed-1
```

Do not expose either listener to the internet until per-feed credentials and firewall rules are configured.

## 3. Add the OBS source

Use OBS 30.2 or newer. Current NOALBS releases use OBS WebSocket requests introduced in OBS 30.2; older OBS versions can connect but fail during startup.

Create the OBS scenes `Live`, `Low Bitrate`, and `BRB`. In `Live`, add a Media Source with local file disabled and input:

```text
srt://127.0.0.1:8890?streamid=read:live/feed-1
```

If OBS is on another host, replace `127.0.0.1` with the server's trusted LAN address. Enable OBS WebSocket on port 4455 and use a strong password.

## 4. Verify health

```sh
curl http://127.0.0.1:9090/healthz
curl http://127.0.0.1:9090/api/v1/feeds/feed-1
```

After the second MediaMTX sample, the feed response reports derived bitrate in kbps. Disconnecting the publisher should set `connected` to false.

## 5. Connect NOALBS manually

Copy `integrations/noalbs/config.example.json` outside the repository, replace the OBS password at deployment, and configure NOALBS to consume:

```text
ws://127.0.0.1:9090/ws-stats?feed=feed-1
```

Run NOALBS directly on the OBS host. The checked-in example therefore uses `software.host` `127.0.0.1`, OBS WebSocket port `4455`, and the host-published stats URL `ws://127.0.0.1:9090/ws-stats?feed=feed-1`.

For NOALBS v2.19.2, the important schema fields are `switcher.switchingScenes` (not `scenes`) and WebSocket `streamServer.url` (not `statsUrl`). The example also includes the required top-level `user`, `chat`, `optionalScenes`, and `optionalOptions` objects, plus `software.collections`. Its reconnect delay is one second and it treats stats as stale after three seconds.

Verify all four transitions:

1. Normal bitrate → `Live`.
2. Bitrate below 1200 kbps → `Low Bitrate`.
3. Publisher stopped → `BRB`.
4. Publisher restarted at normal bitrate → `Live`.

## 6. Run the dashboard on the mini PC

The dashboard is included in the default Compose stack. On the Ubuntu mini PC:

```sh
cd ~/openirl
git pull --ff-only
docker compose -f docker/compose.yaml up --build -d
docker compose -f docker/compose.yaml ps
curl http://127.0.0.1:8080/healthz
```

From an SSH client, create a temporary private tunnel:

```sh
ssh -L 8080:127.0.0.1:8080 YOUR_USER@MINI_PC_LAN_IP
```

Then open `http://127.0.0.1:8080` on that client. This requires no new firewall rule. For routine remote/mobile access, place the loopback-only dashboard behind an authenticated HTTPS reverse proxy or private VPN. Scene and stream mutations require the independent `OPENIRL_CONTROL_TOKEN`; the preview and read-only status do not weaken that boundary.

The Ingest Preview card automatically starts muted playback when `live/feed-1` is available. Its status comes from the real MediaMTX HLS playlist: offline feeds show an offline/reconnecting state instead of a placeholder video. Chrome and Firefox use the bundled HLS.js player; Safari uses native HLS. The browser talks only to the dashboard on port 8080, which proxies the narrow `/preview/live/feed-1/` namespace.

For reliable browser playback, Feed 1 must contain:

- H.264/AVC video (8-bit 4:2:0 is the safest browser profile);
- AAC-LC audio; and
- keyframes every one to two seconds for reasonable HLS startup and latency.

MediaMTX remuxes those tracks into low-latency HLS and does not transcode them. If the sender uses H.265/HEVC, Opus, or another browser-dependent codec, ingest and OBS playback can still work while the dashboard preview fails. Change the encoder at the IRL sender/relay; do not add a software transcode on an N5095 host unless there is no compatible source option.

Validate the private preview endpoints on the mini PC:

```sh
curl -s http://127.0.0.1:8080/api/v1/dashboard/status | jq '.preview'
curl -I http://127.0.0.1:8888/live/feed-1/index.m3u8
curl -I http://127.0.0.1:8080/preview/live/feed-1/index.m3u8
```

With Feed 1 live, both playlist requests should return success and `.preview.available` should be `true`. With the publisher stopped, `.preview.available` becomes `false`. Port 8888 is a host-local diagnostic endpoint only and must not be forwarded or opened in UFW.

## Optional SRTLA ingest (initial milestone)

Start the receiver path with:

```sh
docker compose -f docker/compose.yaml --profile srtla up --build -d
```

It accepts SRTLA on UDP 5000 and forwards the reconstructed SRT session to the same MediaMTX `live/feed-1` path. Existing direct SRT and RTMP inputs are unchanged. Configure the SRTLA sender to use stream ID `publish:live/feed-1`.

The forwarding and sender-side multi-link aggregation are functional. Per-link receiver telemetry, authentication, and automated sender/source-routing setup are not implemented; see `integrations/srtla/README.md`.
