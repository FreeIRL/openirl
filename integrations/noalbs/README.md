# NOALBS integration example

`config.example.json` connects NOALBS to the implemented `stats-bridge` WebSocket endpoint and maps feed state to OBS scenes.

Copy the file beside the NOALBS v2.19.2 executable on the OBS host and replace the OBS password before use. Run NOALBS on that host: both its stats connection (`ws://127.0.0.1:9090/ws-stats?feed=feed-1`) and OBS WebSocket connection (`127.0.0.1:4455`) intentionally use loopback. The example assumes scenes named `Live`, `Low Bitrate`, and `BRB`; OpenIRL does not create or validate them.

Use OBS 30.2 or newer with current NOALBS. The WebSocket server type uses `url`; `statsUrl` belongs to HTTP-based server types.
