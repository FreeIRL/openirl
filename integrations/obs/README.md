# OBS integration

The dashboard backend implements the OBS WebSocket 5.x protocol with Node's built-in WebSocket client. It authenticates with credentials supplied only through the environment and subscribes to scene and output events.

In OBS, open **Tools → WebSocket Server Settings**, enable the server, keep port `4455`, enable authentication, and set a strong password. Ensure OBS listens only on loopback/the local machine. Create scenes named exactly `Live`, `Low Bitrate`, and `BRB`.

The backend accepts those three scene names, stream start/stop, and explicit mute/unmute for the input named by `OBS_INGEST_AUDIO_SOURCE`. It does not expose arbitrary OBS requests or browser-selected inputs. Never forward or publish TCP 4455.

See [Feed 1 authentication and guarded audio upgrade](../../docs/feed-auth-and-audio-upgrade.md) for required `.env` settings, stash preservation, deployment, and validation commands.
