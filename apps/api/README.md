# Control API (planned)

The control API will authenticate operators, validate commands, coordinate service adapters, and publish system status. It must not carry media traffic or expose integration credentials to clients.

There is no API implementation in this directory. Before adding one, define its authentication model, command semantics, status schema, and behavior when downstream services are unavailable.
