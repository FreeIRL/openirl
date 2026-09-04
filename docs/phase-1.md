# Phase 1 development walkthrough

This walkthrough exercises the code that exists today: one direct SRT or RTMP feed through MediaMTX, observed by `stats-bridge`. OBS and NOALBS are configured manually.

## 1. Start the media and health services

From the repository root:

```sh
docker compose -f docker/compose.yaml up --build
```

The public contribution listeners are SRT on UDP 8890 and RTMP on TCP 1935. The MediaMTX API and metrics ports are container-internal; normalized health is available locally on port 9090.

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

Run NOALBS on the OBS host for the simplest network arrangement. Verify transitions by lowering the publisher bitrate and disconnecting it.

## Next milestone: SRTLA

SRTLA receiver support is not implemented. The planned receiver will forward its output to `live/feed-1` and add RTT and packet-loss observations without changing the feed identity.
