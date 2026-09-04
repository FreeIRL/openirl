# SRTLA receiver for feed-1

The optional `srtla-receiver` Compose service builds the OpenIRL `srtla_rec` proxy at a pinned commit. It is designed for Docker Engine on Ubuntu Server 24.04.4 LTS (amd64, including the Intel N5095). It listens on UDP 5000 and forwards the reconstructed SRT session to MediaMTX on UDP 8890. The SRT stream ID passes through unchanged, so configure the sender with `publish:live/feed-1` (or `#!::m=publish,r=live/feed-1`).

Start it with:

```sh
docker compose -f docker/compose.yaml --profile srtla up --build -d
docker compose -f docker/compose.yaml logs -f srtla-receiver mediamtx
```

Publish SRTLA to `srtla://SERVER_IP:5000` with the feed-1 stream ID above. OBS continues to read `live/feed-1`, and direct SRT on UDP 8890 and RTMP on TCP 1935 remain available. Only UDP 5000 must be added to the firewall for SRTLA.

## What this milestone does

- Runs a real SRTLA link-aggregation receiver and forwards its reconstructed SRT packets into the existing MediaMTX listener.
- Supports multiple sender network links when the sender is configured for SRTLA and Linux source routing.
- Keeps the receiver isolated and lightweight enough for an Intel N5095 host; it does not transcode media.

## Current limitations

- This is one unauthenticated public listener. Restrict UDP 5000 at the firewall and do not expose it broadly until per-feed authentication is added.
- OpenIRL does not configure the sender or its source routing. A single sender link works as a transport test but is not bonding.
- The receiver does not yet export per-link RTT or packet-loss metrics. `stats-bridge` continues to derive connection state and bitrate from MediaMTX, so NOALBS switching works but its RTT value remains unavailable.
- SRTLA, direct SRT, and RTMP are alternative inputs to `live/feed-1`; do not publish more than one of them to that path at the same time.
- The upstream receiver is open source but still evolving. Its commit is pinned for repeatable builds; update `SRTLA_REF` deliberately after testing.
