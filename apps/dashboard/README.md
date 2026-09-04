# Operator dashboard

The first responsive operator dashboard is implemented here. Desktop uses an operations-center layout; screens up to 800 px switch to the one-handed mobile control view.

It currently exposes one read-only aggregate endpoint, `GET /api/v1/dashboard/status`. The server reads real Feed 1 and freshness data from `stats-bridge`. MediaMTX health is explicitly labeled as inferred from metrics freshness. OBS, NOALBS, SRTLA per-link telemetry, program preview, and operator commands remain unavailable and the UI says so. Scene and emergency controls are disabled until authentication and the OBS control backend are implemented.

Run locally from the repository root:

```sh
npm install
STATS_BRIDGE_URL=http://127.0.0.1:9090 npm start --workspace @openirl/dashboard
```

Open `http://127.0.0.1:8080`. For LAN or Internet access, keep this service loopback-bound and publish it through an authenticated HTTPS reverse proxy or a private VPN; do not change the Compose binding to `0.0.0.0` without an access-control layer.
