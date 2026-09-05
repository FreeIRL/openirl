# Security baseline

The completed system will handle stream keys, OBS control, and chat credentials. Treat every control component as privileged infrastructure.

- Keep the dashboard, API, MediaMTX API, metrics, OBS WebSocket, and NOALBS on a private network by default.
- Terminate public TLS at a maintained reverse proxy.
- Require authentication and authorization before exposing operator actions.
- Store secrets in environment variables or mounted secret files, never versioned YAML.
- Use distinct publish credentials for each feed and rotate them after disclosure.
- Bind metrics and health endpoints privately unless intentionally proxied.
- Validate clip paths and file types; never accept arbitrary filesystem paths from chat commands.
- Rate-limit Twitch commands and keep their permissions narrower than dashboard controls.
- Use different random values for `OBS_WEBSOCKET_PASSWORD` and `OPENIRL_CONTROL_TOKEN`. The latter is required on every mutating dashboard request.

Production deployment is out of scope until the project has a threat model, authenticated control API, credentialed publishing, and a tested hardening guide.

## Validated single-host firewall baseline

The initial remote SRTLA deployment exposes exactly UDP 5000 and keeps the dashboard, direct SRT/RTMP, OBS, metrics, and control ports private. Before enabling UFW over SSH, keep the current session open and verify the SSH allow rule:

```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 5000/udp comment 'OpenIRL SRTLA'
sudo ufw show added
sudo ufw enable
sudo ufw status verbose
```

Open a second SSH session before closing the first. The router should have one UDP port forward: external port 5000 to port 5000 at the mini PC's DHCP-reserved LAN address. Do not forward TCP 22 to the public Internet merely because it is allowed on the host firewall; restrict SSH at the router or access it over a VPN.

Do **not** forward ports 1935, 8890, 4455, 8080, 8888, 9090, 9997, or 9998. Compose binds dashboard port 8080, HLS playback port 8888, and stats port 9090 to loopback. The browser receives only the `live/feed-1` HLS assets through the dashboard's same-origin preview proxy; MediaMTX control and ingest endpoints are not proxied.

On the single-host Ubuntu deployment, the dashboard container uses host networking solely to connect to OBS at `127.0.0.1:4455`; its HTTP listener is explicitly bound to `127.0.0.1:8080`. Do not change either bind address to `0.0.0.0`. Remote operator access should continue through the documented SSH tunnel or a private authenticated proxy/VPN.

## Ingest credential

MediaMTX validates the publisher credential carried in the stream ID. Configure the secret only on the deployed host and sender. A sender uses this shape:

```text
publish:live/feed-1:openirl-feed-1:YOUR_SECRET
```

Generate a unique value at deployment time, do not paste it into issue reports or logs, and never add the completed stream ID to this repository. The checked-in examples use placeholders only. Per-link SRTLA telemetry is not authentication and is not implemented yet.

The checked-in Feed 1 publish rules now require the existing hash via `FEED_1_PASSWORD_HASH`. Follow [the migration guide](feed-auth-and-audio-upgrade.md) before recreating MediaMTX. Anonymous publishing is disabled. OBS Mute/Unmute controls target only `OBS_INGEST_AUDIO_SOURCE` and require the control token.
