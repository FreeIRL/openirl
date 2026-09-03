# Architecture

## Principles

1. MediaMTX transports media; OpenIRL services coordinate and observe it.
2. A feed identity is independent of its transport.
3. Every service exposes liveness and readiness separately.
4. Loss of the API or dashboard must not interrupt an active media path.
5. Automatic switching uses explicit states and hysteresis to avoid scene flapping.
6. Credentials enter through environment variables or mounted secrets.

## Component boundaries

- **Dashboard:** operator-facing state and commands; no direct media-server credentials.
- **API:** validates commands, publishes state, and coordinates adapters.
- **Ingest manager:** owns the three logical feed slots and transport lifecycle.
- **Stats bridge:** converts MediaMTX, SRTLA, OBS, and NOALBS telemetry into one health model.
- **Clip engine:** selects and cues local BRB media; OBS remains responsible for program playback.
- **Twitch bot:** exposes a deliberately limited command surface through the API.
- **Integrations:** isolate vendor-specific protocols and configuration from domain logic.

## Feed state model

```text
disabled → waiting → connecting → healthy
                       │           │
                       └─ failed ◄─┴─ degraded
```

Transport reconnects do not change a feed's identity. The stats bridge supplies observations; the ingest manager owns feed lifecycle; the switching policy decides whether OBS should remain live or enter a fallback scene.

## Deployment direction

The initial deployment is a single Linux host running MediaMTX and OpenIRL services in containers, with OBS either on the host or another trusted LAN machine. The design should later allow services to move to separate hosts without changing feed IDs or public API contracts.

See [security.md](security.md) before exposing any endpoint outside a private network.
