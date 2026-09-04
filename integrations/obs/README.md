# OBS integration

The dashboard backend implements the OBS WebSocket 5.x protocol with Node's built-in WebSocket client. It authenticates with credentials supplied only through the environment and subscribes to scene and output events.

In OBS, open **Tools → WebSocket Server Settings**, enable the server, keep port `4455`, enable authentication, and set a strong password. Ensure OBS listens only on loopback/the local machine. Create scenes named exactly `Live`, `Low Bitrate`, and `BRB`.

The backend accepts only those three scene names and stream start/stop. It does not expose arbitrary OBS requests or media-source controls. Never forward or publish TCP 4455.
