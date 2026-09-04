# MediaMTX integration

MediaMTX is the media router for contribution feeds and OBS consumption. The checked-in configuration supports unauthenticated SRT and RTMP development traffic; it is not suitable for an internet-facing host.

The reserved paths are `live/feed-1`, `live/feed-2`, and `live/feed-3`. Only `feed-1` is currently exercised by `stats-bridge`. Publisher authentication and TLS remain deployment work.
