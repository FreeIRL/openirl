# Security baseline

The completed system will handle stream keys, OBS control, and chat credentials. Treat every control component as privileged infrastructure.

- Keep the dashboard, API, MediaMTX API, metrics, OBS WebSocket, and NOALBS on a private network by default.
- Terminate public TLS at a maintained reverse proxy.
- Require authentication and authorization before exposing operator actions.
- Store secrets in environment variables or mounted secret files, never versioned YAML.
- Use distinct publish credentials for each feed and rotate them after disclosure.
- Bind metrics and health endpoints privately unless intentionally proxied.
- Validate clip paths and file types; never accept arbitrary filesystem paths from chat commands.
- Rate-limit Twitch commands and keep their permissions narrower than dashboard controls.

Production deployment is out of scope until the project has a threat model, authenticated control API, credentialed publishing, and a tested hardening guide.
