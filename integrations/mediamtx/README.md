# MediaMTX integration

MediaMTX is the media router for contribution feeds and OBS consumption. The checked-in configuration permits only credentialed Feed 1 publishing. Compose requires the existing password hash via `.env`; anonymous reads/playback remain available.

The reserved paths are `live/feed-1`, `live/feed-2`, and `live/feed-3`. Only `feed-1` is currently exercised by `stats-bridge`. Feed 2/3 publishing is disabled. Private listeners and firewall rules remain required.

MediaMTX remuxes `live/feed-1` to low-latency HLS without transcoding. Compose binds its HLS listener to host loopback on TCP 8888, and the dashboard backend exposes only that feed beneath `/preview/live/feed-1/`. Browser playback requires H.264 video and AAC audio; configure the source for a one- or two-second keyframe interval for lower startup delay. H.265 may work in some MediaMTX clients but is not a portable browser preview codec.

See [Feed 1 authentication and guarded audio upgrade](../../docs/feed-auth-and-audio-upgrade.md) for required `.env` settings, stash preservation, deployment, and validation commands.
