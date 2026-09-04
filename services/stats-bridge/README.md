# Stats bridge

The first runnable OpenIRL service. It polls MediaMTX Prometheus metrics for one stable feed, derives inbound bitrate from byte-counter deltas, and exposes the result to operators and NOALBS.

## Endpoints

- `GET /healthz` — process and upstream freshness
- `GET /api/v1/feeds/:feedId` — latest normalized feed state
- `WS /ws-stats?feed=feed-1` — NOALBS-compatible stats messages

## Configuration

| Variable | Default |
| --- | --- |
| `PORT` | `9090` |
| `MEDIAMTX_METRICS_URL` | `http://mediamtx:9998/metrics` |
| `FEED_ID` | `feed-1` |
| `MEDIA_PATH` | `live/feed-1` |
| `POLL_INTERVAL_MS` | `1000` |
| `STALE_AFTER_MS` | `5000` |

Bitrate is reported in kbps. MediaMTX exposes cumulative bytes, so the first successful sample reports zero and the following samples report a rate. RTT and packet loss remain zero until the SRTLA adapter supplies those observations.
