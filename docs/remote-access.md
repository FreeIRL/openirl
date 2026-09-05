# Secure remote/mobile access (Ubuntu Server 24.04)

For CGNAT or no-port-forward access, use the recommended [Cloudflare Tunnel + Access guide](cloudflare-access.md). It needs no new inbound ports. This page retains the direct-public Caddy option and private-mesh Tailscale alternative; choose one remote access method.

The Caddy single-operator path is phone → Caddy HTTPS + Basic login →
`127.0.0.1:8080` → existing narrow dashboard API/preview. Caddy's stock image
handles certificates and WebSocket upgrades with little operational overhead.
There is no route to OBS, stats WebSocket, MediaMTX API/metrics or raw HLS.
The dashboard's **separate control token is still required for mutations**.
Use different randomly generated passwords for outer login, control and OBS.

## 1. Prepare the mini PC

Run from the existing repository root. Preserve `.env` and the existing feed hash;
do not copy `.env.example` over it. Pull after this change reaches main:

```sh
git switch main
git pull --ff-only
chmod 600 .env
```

Use a maintained Docker Engine **28+** and Compose v2. Check `docker version`.
Docker-published ports can bypass UFW; older engines also have a localhost
publication isolation caveat. This version binds 1935/TCP, 8890/UDP, 8888/TCP,
9090/TCP and dashboard 8080 to loopback. API/metrics have no host publication.
Only SRTLA UDP 5000 is published externally. Remove wildcard mappings from any
local override; do not add them back. OBS must listen on loopback or be protected
by host firewall rules; verify its actual listener. NOALBS needs no public port.

During a maintenance break (MediaMTX recreation briefly interrupts ingest):

```sh
docker compose --env-file .env -f docker/compose.yaml --profile srtla up -d --build
curl --fail http://127.0.0.1:8080/healthz
sudo ss -lntup
docker ps --format 'table {{.Names}}\t{{.Ports}}'
sudo ufw status verbose
```

Keep the existing deny-incoming policy, SSH rule and UDP 5000 rule. Keep an SSH
session open while editing firewall rules and confirm a second session works.

## 2. Configure Caddy credentials

Hash a strong password interactively (no plaintext command-line argument):

```sh
docker run --rm -it caddy:2.11.4-alpine caddy hash-password
```

Append/edit these entries in the existing `.env` using an editor:

```dotenv
OPENIRL_DOMAIN=control.example.com
OPENIRL_AUTH_USER=operator
OPENIRL_AUTH_HASH='$2a$...paste-the-entire-generated-bcrypt-hash...'
```

Domain must be a hostname only: no scheme, port, slash or whitespace. Username
should be a simple alphanumeric identifier. **Single-quote the hash** so Compose
preserves its dollar signs. Do not double the dollar signs in `.env`. Keep
`OPENIRL_CONTROL_TOKEN` set to its existing independent secret. Never source
`.env` as shell code. It is gitignored; hashes are still sensitive and Docker
administrators can inspect container environments. Do not share `compose config`
output or add real credentials to tracked YAML.

All following proxy commands explicitly load `.env`. The optional second file
keeps Caddy absent from the default stack. Validate before opening ports:

```sh
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.https.yaml config --quiet
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.https.yaml run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

## 3A. Direct public Internet: your own domain

Create an A record `control.<domain>` pointing to your public IPv4 address. Add
AAAA **only** if the mini PC has working publicly reachable IPv6 and appropriate
IPv6 firewall rules; remove stale AAAA records. Use DNS-only resolution to Caddy.
Reserve the mini PC's LAN address in DHCP. If the address changes, update DNS or
use dynamic DNS. CGNAT cannot be fixed with a router forward; use 3C instead.

Forward **TCP 80 and 443 only** to the mini PC for the dashboard. Retain the
already-configured **UDP 5000** SRTLA forward. Do not forward 4455, 8080, 9090,
8888, 1935, 8890, 9997, 9998 or NOALBS ports. Caddy's admin API is disabled.
HTTP on 80 redirects to HTTPS and supports ACME; it never serves the dashboard.
Caddy can also use TLS-ALPN validation on 443. Both ports are the recommended
standard setup; no UDP 443 is used here.

```sh
sudo ufw allow 80/tcp comment 'OpenIRL ACME and HTTPS redirect'
sudo ufw allow 443/tcp comment 'OpenIRL HTTPS'
sudo ufw status verbose
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.https.yaml up -d --no-deps caddy
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.https.yaml logs --tail=50 caddy
```

Check no other service already owns 80/443. Certificate state persists in named
volumes across restarts. Caddy must have outbound DNS and HTTPS access for ACME.
If issuance fails, check A/AAAA, upstream NAT, ISP filtering, clock and logs.
Do not repeatedly delete certificate state or retry issuance in a tight loop.

DNS challenge is an alternative for advanced setups: it requires a Caddy build
with your DNS provider module and a least-privilege DNS API secret. It removes
the inbound port 80 validation requirement, but **public dashboard access still
requires TCP 443**. It does not bypass CGNAT. This stock-image v1 uses no DNS API
credentials or custom modules.

## 3B. LAN-only (no router changes)

Simplest: keep the default stack and existing SSH tunnel from a LAN computer:
`ssh -N -L 8080:127.0.0.1:8080 USER@MINI_PC_LAN_IP`. Visit
`http://127.0.0.1:8080`. The app remains loopback-only.

For phone HTTPS on LAN, configure local DNS (including your phone's resolver)
to resolve `control.home.arpa` to the mini PC LAN IP, set that as OPENIRL_DOMAIN,
and add `tls internal` inside the site block in a **local copy** of Caddyfile.
Copy `docker/compose.https.yaml` to the ignored `docker/compose.override.yaml`
and change its Caddyfile mount to that local file (store it under ignored `data/`).
Use `-f docker/compose.override.yaml` instead of `-f docker/compose.https.yaml`
in every proxy command. Allow TCP 443 only from your actual LAN subnet with
`sudo ufw allow from YOUR_LAN_CIDR to any port 443 proto tcp`.
Do not add the public firewall rules or router forwards in 3A.

After starting, copy `/data/caddy/pki/authorities/local/root.crt` out of the Caddy
container and securely install/trust it on each phone (iOS requires enabling
full trust). Distribute **only root.crt**, never the CA private key. Without this
trust step browsers reject the certificate. Retain Basic authentication.
For an easier trusted-certificate phone setup, use 3C on LAN as well.

## 3C. CGNAT/private remote access: Tailscale Serve

This is a separate alternative to Caddy, with Tailscale identity/device access
as the outer authentication layer. Install Tailscale on the mini PC and phone,
sign both into your tailnet, enable HTTPS certificates and restrict tailnet
grants/ACLs to the operator's devices on HTTPS. Audit the default access policy.
Do not enable Funnel (public access). Stop Caddy first if it was started.

```sh
sudo tailscale serve --bg http://127.0.0.1:8080
sudo tailscale serve status
```

Open the HTTPS `*.ts.net` address reported by Serve from the signed-in phone.
The control token remains required. No router changes, new UFW public rules,
or custom domain are needed; `control.example.com` is for mode 3A. Tailscale
Serve terminates TLS and proxies the dashboard only. Existing SRTLA ingress is
unchanged; this does not tunnel the stream sender. See the official
[Tailscale Serve guide](https://tailscale.com/docs/features/tailscale-serve).

## 4. Verify before relying on remote control

For Caddy mode set a shell variable to your configured hostname:

```sh
OPENIRL_TEST_DOMAIN=control.example.com
curl --fail http://127.0.0.1:8080/healthz
curl -I "http://$OPENIRL_TEST_DOMAIN/" # redirect, no dashboard content
curl -i "https://$OPENIRL_TEST_DOMAIN/healthz" # 401
curl -i "https://$OPENIRL_TEST_DOMAIN/preview/live/feed-1/index.m3u8" # 401
curl --user operator --fail "https://$OPENIRL_TEST_DOMAIN/healthz" # prompts password; 200
curl --user operator -i -X POST "https://$OPENIRL_TEST_DOMAIN/api/v1/control/stream/start" # 401: control token absent, no action
curl --user operator --fail "https://$OPENIRL_TEST_DOMAIN/preview/live/feed-1/index.m3u8" # playlist when ingest is active
```

Never use `-k` for public TLS. Test from cellular, not just hairpin NAT on Wi-Fi.
Log in on the phone, confirm status updates and HLS playback, then enter the
separate control token and test a reversible scene change or Mute/Unmute during
a maintenance window. Check portrait layout and resume after backgrounding.
Preview requests must stay at `/preview/live/feed-1/...` on the HTTPS origin;
there should be no mixed content or browser request to port 8888. Offline ingest
may produce a preview error after authentication; it must not bypass login.
Native iOS HLS and hls.js both need this real-device check.

From another LAN machine, confirm TCP 1935, 4455, 8080, 8888, 9090, 9997 and 9998
are unreachable (for example `nmap -sT -p 1935,4455,8080,8888,9090,9997,9998 MINI_PC_IP`).
Repeat against the public address from outside, including IPv6 if configured.
Audit `docker ps` and `ss` for UDP 8890 as well: UDP scans alone are inconclusive.
The intended public set is TCP 80/443 plus existing UDP 5000, not backend ports.

## Operations, limits and rollback

Basic auth has no MFA and browsers cache login credentials. Use a long unique
password, a trusted phone and a private browser session on shared devices.
Close the session to clear cached login; rotate the hash to revoke access.
Stock Caddy has no built-in general request rate limiter. This v1 does not claim
brute-force/DoS protection: prefer Tailscale when public access is unnecessary.
Do not apply UFW connection limiting to HTTPS: HLS creates sustained requests
and HTTP/2 multiplexing makes it a poor authentication limiter. A future auth
service or maintained limiter can throttle failed logins without limiting media.
Security headers prevent framing, restrict resource origins and disable caching;
HLS blob workers/media and streaming responses remain allowed. No access log
is enabled, reducing the chance of recording control credentials.

For config-only changes validate, then `restart caddy` using the same two-file
`docker compose --env-file .env ...` prefix. The admin API is disabled, so live
reload is unavailable; the short restart interrupts preview, not ingest/OBS.
For `.env` changes use `up -d --no-deps --force-recreate caddy` with that prefix
(`restart` alone does not refresh environment). Periodically update the pinned
Caddy image after reviewing security releases and validating it.

Rollback only the proxy; do **not** run whole-stack `down`:

```sh
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.https.yaml stop caddy
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.https.yaml rm -f caddy
sudo ufw delete allow 80/tcp
sudo ufw delete allow 443/tcp
```

Remove only rules you added (LAN mode uses its scoped rule), remove the 80/443
router forwards, and return to the SSH tunnel. Keep the loopback ingest bindings,
SSH and UDP 5000. Retain named Caddy volumes for future certificates; if permanently
uninstalling, inspect and remove only `openirl_caddy_data` and
`openirl_caddy_config` after backup. Delete unused auth entries from `.env`.
For Tailscale rollback use `sudo tailscale serve reset`; leave streaming intact.
HSTS is cached for a year, so the public hostname remains HTTPS-only in browsers;
the loopback SSH URL is unaffected.

References: [Caddy authentication](https://caddyserver.com/docs/caddyfile/directives/basic_auth),
[Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[Docker firewall behavior](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

## Developer validation

Run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run check` and
`python3 -m unittest discover -s test -p '*_test.py'`. With a local Caddy 2.11.4
binary, run `CADDY_BIN=/absolute/path/to/caddy node --test test/https-smoke.test.cjs`.
The optional test uses isolated loopback ports and a temporary untrusted CA,
checks outer authentication on pages/status/HLS, preserves the mutation token,
and fetches a fixture playlist and segment through HTTPS. It never installs a
CA or touches OBS. Without CADDY_BIN this test is explicitly skipped. Real ACME,
Docker host networking and phone playback still require the deployment checks above.
