# OpenIRL

OpenIRL is a free, self-hosted control plane for IRL livestreaming. The project is being designed around a small home server and three simultaneous contribution feeds, with MediaMTX handling media transport and OBS producing the final program output.

> [!IMPORTANT]
> OpenIRL is in the scaffolding phase. The repository currently defines boundaries, configuration, and the intended deployment shape; it is not ready for production streaming.

## Goals

- Accept up to three simultaneous contribution feeds using SRTLA, SRT, RTMP, or RTMPS.
- Normalize and route media through MediaMTX.
- Control OBS remotely through obs-websocket.
- Let NOALBS switch between live, degraded, offline, and BRB scenes.
- Play managed BRB clips when a contribution feed is unavailable.
- Expose health, bitrate, connection, and service status to a dashboard.
- Provide Twitch chat commands and operational notifications.
- Remain practical on modest self-hosted hardware, including Intel Quick Sync systems.

## Supported platforms

OpenIRL's primary server target is **Ubuntu Server 24.04.4 LTS**.

| Platform | Status | Notes |
| --- | --- | --- |
| Ubuntu Server 24.04.4 LTS | Primary | First installer and deployment target |
| Ubuntu Desktop 24.04 LTS | Supported target | Useful for development and non-headless OBS |
| Other Linux distributions | Planned | Support will follow after the Ubuntu Server path is stable |
| Windows | Later | Not a v1 server-host target |
| macOS | Not planned as a server target | Development/client use only |

On Ubuntu Server, OBS will run headlessly using a virtual Xorg/Xvfb-style display session or equivalent. On Intel systems such as N5095-class mini PCs, OpenIRL should use Intel VA-API / Quick Sync hardware acceleration where available instead of relying on CPU-heavy software encoding.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/dashboard` | Operator dashboard and mobile-friendly controls |
| `apps/api` | Public API, authentication, orchestration, and service status |
| `services/ingest-manager` | Feed lifecycle and protocol-to-MediaMTX coordination |
| `services/stats-bridge` | Health and telemetry normalization |
| `services/clip-engine` | BRB clip catalog and playback coordination |
| `services/twitch-bot` | Twitch chat commands and notifications |
| `integrations/obs` | OBS WebSocket adapter and scene contract |
| `integrations/noalbs` | NOALBS adapter and switching policy |
| `integrations/mediamtx` | MediaMTX configuration and path conventions |
| `integrations/srtla` | SRTLA receiver integration notes |
| `config` | Versioned, non-secret configuration examples |
| `docker` | Self-hosted container deployment assets |
| `docs` | Architecture and operating documentation |
| `scripts` | Setup, validation, and maintenance scripts |

## High-level flow

```text
Cameras / phones
  ├─ SRTLA
  ├─ SRT
  ├─ RTMP
  └─ RTMPS
        │
        ▼
Ingest manager ──► MediaMTX ──► OBS ──► streaming platform
        │               │         ▲
        └─ health ───────┴─► NOALBS / stats bridge
                                  │
Dashboard / API / Twitch bot ◄────┴────► clip engine
```

Each logical feed has one stable identity (`feed-1`, `feed-2`, or `feed-3`) regardless of transport. Secrets and stream keys must be supplied at deployment time and must never be committed.

## Getting started

1. Use Ubuntu Server 24.04.4 LTS for the primary supported server deployment.
2. Install Node.js 22 or newer and npm 10 or newer.
3. Copy `.env.example` to `.env` and fill in only the integrations you are testing.
4. Review `config/openirl.example.yaml` for the initial feed and scene contract.
5. Run `npm install` once package implementations begin.
6. Run `npm run check` to validate the workspace placeholders.

The first implementation milestone is one end-to-end SRT/SRTLA feed routed through MediaMTX into OBS, with NOALBS-driven fallback. Additional transports and feeds should follow only after that path is measurable and reliable.

## Status and contribution

Interfaces are intentionally small while the architecture is validated. Before implementing a component, document its inputs, outputs, failure behavior, and ownership in that component's README. See [docs/architecture.md](docs/architecture.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## License

OpenIRL is licensed under the [MIT License](LICENSE). Third-party services and binaries retain their own licenses.
