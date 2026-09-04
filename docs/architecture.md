# Architecture

## Constraints

1. MediaMTX transports media; OpenIRL services coordinate and observe it.
2. A feed identity is independent of its transport.
3. Every service exposes liveness and readiness separately.
4. Loss of the API or dashboard must not interrupt an active media path.
5. Automatic switching uses explicit states and hysteresis to avoid scene flapping.
6. Credentials enter through environment variables or mounted secrets.

## Planned component boundaries

The `stats-bridge`, dashboard, and narrow OBS adapter are implemented. The remaining boundaries describe the intended ownership model.

- **Dashboard:** operator-facing state and a loopback-only backend that owns OBS credentials, validates a fixed command allowlist, and requires a control token for mutations.
- **API:** validates commands, publishes state, and coordinates adapters.
- **Ingest manager:** owns the three logical feed slots and transport lifecycle.
- **Stats bridge:** converts MediaMTX, SRTLA, OBS, and NOALBS telemetry into one health model.
- **Clip engine:** selects and cues local BRB media; OBS remains responsible for program playback.
- **Twitch bot:** exposes a deliberately limited command surface through the API.
- **Integrations:** isolate vendor-specific protocols and configuration from domain logic.

## Proposed feed state model

```text
disabled → waiting → connecting → healthy
                       │           │
                       └─ failed ◄─┴─ degraded
```

Transport reconnects do not change a feed's identity. The implemented stats bridge supplies MediaMTX observations. The ingest manager and switching policy described here do not exist yet.

## Deployment direction

The primary deployment target is **Ubuntu Server 24.04.4 LTS** on a single Linux host. The intended deployment colocates MediaMTX, OpenIRL services, and OBS; OBS may also run on another trusted LAN machine. This topology has not yet been packaged as an installer.

Because Ubuntu Server is headless by default, colocated OBS requires a managed virtual display/session such as Xorg/Xvfb or an equivalent approach. The deployment layer should treat the OBS display session as a supervised dependency rather than requiring a full desktop environment.

For Intel systems, especially N5095-class mini PCs and similar low-power hosts, the deployment should detect and prefer Intel VA-API / Quick Sync hardware acceleration where available. `/dev/dri` access and the relevant Intel media drivers should be validated by diagnostics before OBS or FFmpeg hardware encoding is enabled.

Installer work will target Ubuntu Server 24.04.4 LTS first. Other distributions can be evaluated after that path is stable. Service boundaries should allow components to move to separate hosts without changing feed IDs or public API contracts.

See [security.md](security.md) before exposing any endpoint outside a private network.
