# Contributing to OpenIRL

OpenIRL is pre-release software with one runnable service. Contributions should either strengthen the existing MediaMTX-to-`stats-bridge` path or implement a clearly documented part of the planned architecture.

## Before opening a pull request

- Discuss new services and public contract changes in an issue first.
- Keep media transport in MediaMTX rather than proxying it through the control API.
- Do not commit stream keys, OAuth tokens, passwords, recordings, or viewer data.
- Document configuration, failure behavior, and operational ownership for runnable components.
- Include health reporting and actionable errors for long-running services.
- Account for low-power hosts; prefer hardware-assisted encoding in deployment guidance.

Install dependencies and run:

```sh
npm run check
```

The command currently checks `stats-bridge`, the only implemented workspace. Add relevant tests and checks when making another workspace runnable.

## Pull requests

Keep changes focused. In the description, state what is implemented, how it was tested, and any known operational limits. Do not describe planned behavior as available behavior.
