# Cloudflare Tunnel + Access (Ubuntu Server 24.04 / Docker)

Recommended for phone dashboard access behind CGNAT or without router forwarding:
phone → HTTPS / Cloudflare Access → encrypted Cloudflare Tunnel → cloudflared →
`http://127.0.0.1:8080` OpenIRL. Use the official cloudflared Docker image with
`docker/compose.cloudflare.yaml`. Linux host networking makes that exact origin
work: loopback is the mini PC's loopback, not an isolated container. No Docker
socket, host files, published ports or extra services are needed. Connector
metrics bind only to `127.0.0.1:20241` (reserve this port).

Tunnel does **not** replace Access. Without a separately configured Access
application, the hostname is publicly reachable. Cloudflare terminates public
TLS and can process the HTTP traffic; the origin hop is local HTTP over loopback
after the encrypted tunnel. `OPENIRL_CONTROL_TOKEN` remains independently required
for mutations. No Caddy credentials or origin TLS certificate are needed here.

## 1. Prepare and choose a hostname

Use a domain you control with DNS active on Cloudflare and a Cloudflare Zero
Trust account. Examples below use `control.example.com`; substitute your hostname.
Use Docker Engine 28+ and Compose v2 on Ubuntu. Preserve the existing `.env`,
feed password hash, OBS settings and control token. Never overwrite it with the
example. From the mini PC, after the commit is available on main:

```sh
cd ~/openirl
git switch main
git pull --ff-only
chmod 600 .env
```

If Caddy is currently running, stop only that proxy using its existing credentials:

```sh
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.https.yaml stop caddy
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.https.yaml rm -f caddy
```

Remove the old TCP 80/443 router forwards and only the corresponding UFW rules
previously added for Caddy. Keep its files and certificate volumes for future use.
If switching from Tailscale Serve, use `sudo tailscale serve reset`. Do not combine
the Cloudflare and Caddy overlays or use whole-stack `down` / `--remove-orphans`.

## 2. Configure Access BEFORE publishing

In Cloudflare Zero Trust, open **Access → Applications → Add an application →
Self-hosted**. Name it OpenIRL and set the public hostname to
`control.example.com`. Leave the path empty so the entire hostname is protected,
including `/healthz`, `/api/*`, `/preview/*` and static assets.

Add an **Allow** policy with **Include → Emails → your exact operator email**
(or a narrowly scoped identity-provider identity/group). Use one-time PIN email
login or configure your identity provider in Zero Trust authentication settings;
select the intended login method for this application. Save the application and
policy. Explicitly deny everyone else by retaining Access's default deny for
identities that do not match this Allow policy. Do not add Everyone Allow,
Bypass policies, or unprotected preview paths. A blanket Block Everyone policy
is unnecessary and can override the operator Allow policy.

## 3. Create the tunnel and DNS route

In Cloudflare's **Networking → Tunnels** (also available under Zero Trust
**Networks → Connectors / Cloudflare Tunnels**, depending on the dashboard),
create a tunnel, choose **Cloudflared**, name it OpenIRL, and select the **Docker**
connector instructions. Copy only the token from the generated `--token ...`
command into the existing `.env` with an editor; do not run that Docker command
as well as Compose and do not put the token in shell history:

```sh
nano .env
```

Add this entry, replacing the placeholder locally:

```dotenv
CLOUDFLARE_TUNNEL_TOKEN=PASTE_YOUR_TUNNEL_TOKEN_HERE
```

The token is a sensitive connector credential, not a Cloudflare API token.
Anyone holding it can run a connector for this tunnel. Never commit, paste into
chat, or share it. `.env` is ignored by Git, but Docker administrators can inspect
container environments. Use `config --quiet`; full `config` output reveals it.
Never source `.env` as a shell script.

Under the tunnel's **Published application routes / Public Hostnames**, add:

- Hostname: `control.example.com`, with no path restriction.
- Service type: **HTTP**; URL: **127.0.0.1:8080** (full target `http://127.0.0.1:8080`).
- No other hostname, wildcard, private-network route or internal-service target.

The dashboard creates the proxied DNS record to the tunnel's `cfargotunnel.com`
target. Do not create an A/AAAA record to your home IP. If a record already exists
for this hostname, remove only that conflicting record before adding the route.
Confirm Access covers this exact hostname before starting the connector. The
origin route is remotely managed: Compose does not enforce it, so audit the
Cloudflare configuration and restrict who can edit it. Host networking permits
local connectivity; never add routes to other local ports.

## 4. Validate and start

Keep `OPENIRL_CONTROL_TOKEN` set and `PREVIEW_UPSTREAM_URL=http://127.0.0.1:8888`.
During a maintenance break (base recreation can briefly interrupt ingest):

```sh
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.cloudflare.yaml config --quiet
docker compose --env-file .env -f docker/compose.yaml --profile srtla up -d --build
curl --fail http://127.0.0.1:8080/healthz
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.cloudflare.yaml pull cloudflared
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.cloudflare.yaml up -d --no-deps cloudflared
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.cloudflare.yaml logs --tail=50 cloudflared
curl --fail http://127.0.0.1:20241/ready
sudo ss -lntup
docker ps --format 'table {{.Names}}\t{{.Ports}}'
sudo ufw status verbose
```

Look for registered tunnel connections and a healthy connector in Cloudflare.
Keep UFW deny-incoming, the existing SSH rule and SRTLA UDP 5000 rule. No new
inbound firewall/router rules are needed. UDP 5000 remains the only required
public inbound stream port. Tunnel provides dashboard access through CGNAT;
it does not solve CGNAT for incoming SRTLA media. Keep the existing streaming
connectivity arrangement. Do not expose 8080, OBS 4455, stats 9090, HLS 8888,
RTMP 1935, SRT 8890, MediaMTX API/metrics 9997/9998 or NOALBS. Check both IPv4 and
IPv6 and local Compose overrides; Docker publications can bypass UFW.

If the connector cannot connect, check token, DNS, clock and outbound connectivity.
Restricted egress networks need Cloudflare's documented tunnel destinations on
port 7844 UDP (QUIC) / TCP (HTTP/2), plus DNS resolution. This is outbound access,
not an inbound rule. A 502 after Access login usually means the local dashboard
is unavailable or the origin route is wrong; check local health first.

## 5. Verify the Access gate, preview and controls

From outside the home network, without an Access session:

```sh
OPENIRL_TEST_DOMAIN=control.example.com
curl -i "https://$OPENIRL_TEST_DOMAIN/healthz"
curl -i "https://$OPENIRL_TEST_DOMAIN/preview/live/feed-1/index.m3u8"
```

Expect an Access login redirect or denial, never dashboard JSON or a playlist.
Do not use `-k` or interpret any redirect as proof: verify it is the Access login.
On the phone using cellular and a private browser session, verify an unauthorized
identity cannot enter, then sign in as the operator. Check authenticated
`/healthz`, status updates and the live HLS preview while ingest is active.
All playlist, child playlist, segment and low-latency HLS requests must stay under
`https://control.example.com/preview/live/feed-1/...`; the existing dashboard
proxy serves them on the same origin without revealing the internal upstream.
No second HLS hostname, public port 8888, mixed content, or Access bypass is needed.
Leave caching disabled for this hostname; remove any custom Cache Everything rule.

Before entering the control token, controls must remain unauthorized. Enter the
existing independent token and test a reversible scene change or Mute/Unmute in
a maintenance window. Verify portrait layout, native iOS HLS / hls.js as applicable,
and resume after backgrounding. If Access expires, sign in again and reload the
page; login HTML cannot be decoded as HLS. Offline ingest may show a preview
error after login. It must never bypass Access. These are real-device acceptance
checks; unit tests cannot validate your Cloudflare policy or phone playback.

## Updates and rollback

The official `latest` image follows Cloudflare's Docker setup path. Updates are
explicit: repeat `pull cloudflared` and `up -d --no-deps cloudflared` above during
a maintenance window, then repeat readiness and phone checks. For reproducible
rollouts, record the tested image digest and pin the overlay to that digest.
After editing a token use the same Compose prefix with
`up -d --no-deps --force-recreate cloudflared`; `restart` does not load new env.
Avoid debug logs because request headers can contain credentials.

To roll back only remote access, while the token is still in `.env`:

```sh
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.cloudflare.yaml stop cloudflared
docker compose --env-file .env -f docker/compose.yaml -f docker/compose.cloudflare.yaml rm -f cloudflared
curl --fail http://127.0.0.1:8080/healthz
```

Remove the public hostname route and its DNS record, then delete the tunnel to
revoke its connector credential. Remove the token from `.env`. Keep Access until
the route is gone; delete the unused application afterward if desired. If a token
leaks, revoke/rotate it immediately in Cloudflare and disconnect existing tunnel
connections (rotation alone may leave active connectors); deleting the tunnel
and creating a replacement is the simple complete revocation path. Update `.env`
and recreate only cloudflared if continuing service.

Local dashboard, OBS and ingest remain intact. Continue using an SSH tunnel
(`ssh -N -L 8080:127.0.0.1:8080 USER@MINI_PC_LAN_IP`) or the existing
[Caddy / Tailscale alternatives](remote-access.md). No systemd connector is needed
when Docker already manages the stack.

References: [Tunnel setup](https://developers.cloudflare.com/tunnel/setup/),
[Access self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/),
[Run parameters](https://developers.cloudflare.com/tunnel/advanced/run-parameters/),
[Token revocation](https://developers.cloudflare.com/tunnel/advanced/tunnel-tokens/).
