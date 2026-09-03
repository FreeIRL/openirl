# Contributing

OpenIRL is early-stage. Keep changes small, observable, and usable on modest self-hosted hardware.

## Ground rules

- Open an issue before introducing a new service or changing a public contract.
- Never commit stream keys, OAuth tokens, passwords, recordings, or viewer data.
- Keep media transport out of the control API; MediaMTX owns media routing.
- Add health checks and useful error messages with every runnable component.
- Document configuration defaults and failure behavior.
- Prefer hardware-assisted encoding in deployment guidance; do not assume a powerful CPU.

Run `npm run check` before submitting a pull request. More specific testing and formatting commands will be added as implementations land.
