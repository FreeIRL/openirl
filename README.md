# OpenIRL

OpenIRL is an early-stage, self-hosted toolkit for resilient IRL livestreaming. MediaMTX carries contribution feeds, OBS produces the program output, and OpenIRL supplies the health data and control services around them.

> [!WARNING]
> This repository is not a complete streaming system. The MediaMTX development configuration and `stats-bridge` service are runnable; the remaining components are design work and have no implementation yet.

## What works today

- A version-pinned MediaMTX container accepts direct SRT and RTMP publishers.
- `stats-bridge` polls MediaMTX metrics and exposes feed state over HTTP and WebSocket.
- A NOALBS example consumes the bridge's feed statistics.
- A responsive, read-only operator dashboard presents live Feed 1 telemetry.
- Tests cover Prometheus parsing and bitrate calculation.

The current path is deliberately limited to one feed (`feed-1`). SRTLA reception and the read-only dashboard are runnable. OBS automation, authentication/control API, multi-feed management, clip playback, and Twitch commands remain planned work. See [Phase 1](docs/phase-1.md) for the working development path.

## Target system

OpenIRL is intended to:

- accept as many as three contribution feeds over SRTLA, SRT, RTMP, or RTMPS;
- route those feeds through MediaMTX;
- control OBS through obs-websocket;
- supply NOALBS with stable health signals for fallback switching;
- expose feed and service health to an operator dashboard; and
- support a small, permission-aware set of Twitch chat commands.

These are project goals, not claims about the current implementation.

## Platform support

Ubuntu Server 24.04.4 LTS is the first deployment target. The planned colocated setup runs OBS in a supervised virtual display session and uses Intel VA-API or Quick Sync when available. Installer automation and hardware diagnostics have not been implemented.

| Platform | Project position |
| --- | --- |
| Ubuntu Server 24.04.4 LTS | Primary deployment target |
| Ubuntu Desktop 24.04 LTS | Development target; not yet validated end to end |
| Other Linux distributions | Not yet supported |
| Windows and macOS | Development clients only; not server targets |

## Repository map

| Path | Status | Scope |
| --- | --- | --- |
| `services/stats-bridge` | Runnable | MediaMTX telemetry normalization and NOALBS feed |
| `integrations/mediamtx` | Runnable baseline | Development routing configuration |
| `integrations/noalbs` | Example | NOALBS connection and scene mapping |
| `apps/api` | Planned | Authentication, commands, and public status API |
| `apps/dashboard` | Runnable, read-only | Responsive operator status UI; controls await auth/API |
| `services/ingest-manager` | Planned | Feed and receiver lifecycle |
| `services/clip-engine` | Planned | BRB media catalog and cueing |
| `services/twitch-bot` | Planned | Chat commands and notifications |
| `integrations/obs` | Planned | obs-websocket adapter and scene contract |
| `integrations/srtla` | Planned | Bonded contribution receiver |

## Development

Requirements:

- Node.js 22 or newer
- npm 10 or newer
- Docker with Compose for the end-to-end development path

Install dependencies and run the implemented checks:

```sh
npm install
npm run check
```

To exercise the media and telemetry path, follow [docs/phase-1.md](docs/phase-1.md). The checked-in MediaMTX configuration has no publisher credentials and must not be exposed to the public internet.

## Design constraints

- Media transport remains independent of the control plane.
- Feed identity does not change when transport changes.
- Losing the API or dashboard must not interrupt active media.
- Credentials belong in environment variables or mounted secret files.
- Deployment guidance must remain practical for low-power Intel hosts.

More detail is available in [Architecture](docs/architecture.md), [Security](docs/security.md), and [Contributing](CONTRIBUTING.md).

## License

[MIT](LICENSE). Third-party services and binaries retain their own licenses.
