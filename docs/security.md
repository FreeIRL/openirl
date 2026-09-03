# Security baseline

OpenIRL will handle stream keys, OBS control, and chat credentials. Treat the control plane as privileged infrastructure.

- Keep the dashboard, API, MediaMTX API, metrics, OBS WebSocket, and NOALBS on a private network by default.
- Terminate public TLS at a maintained reverse proxy.
- Require authentication and authorization before exposing operator actions.
- Store secrets in environment variables or mounted secret files, never versioned YAML.
- Use distinct publish credentials for each feed and rotate them after disclosure.
- Bind metrics and health endpoints privately unless intentionally proxied.
- Validate clip paths and file types; never accept arbitrary filesystem paths from chat commands.
- Rate-limit Twitch commands and keep their permissions narrower than dashboard controls.

A formal threat model and hardening guide will be required before the first production release.
