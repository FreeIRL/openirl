# Ingest manager (planned)

The ingest manager will own the lifecycle of up to three logical feeds and map their transports to stable MediaMTX paths. Receiver restarts and transport changes must not change a feed's identity.

There is no ingest manager implementation in this directory. Its contract must define feed allocation, receiver supervision, retries, and cleanup before code is added.
