# Feed 1 authentication and OBS audio upgrade

The preview commit `adf4434` retains the development `any` publisher with no path restriction. Stashing the deployed authentication edits before pulling can therefore reopen anonymous publishing. This update removes anonymous publishing. Only `openirl-feed-1` may publish, and only to `live/feed-1`. Feed 2/3 publishing is denied until separate credentials are deliberately configured.

Anonymous read/playback remains permitted as before. API/metrics retain the existing loopback and `172.16.0.0/12` container-network restriction. These are trusted local networks; do not put untrusted containers there. Keep the existing private port and firewall configuration.

The versioned YAML holds the permissions; Compose overrides only the first user's password using `MTX_AUTHINTERNALUSERS_0_PASS`. `FEED_1_PASSWORD_HASH` in the private `.env` must contain the **existing** `sha256:` plus base64 digest (not a hex digest and not the ingest secret). Compose refuses an empty/missing variable. The YAML fallback `sha256:UNCONFIGURED` is deliberately not a full digest and cannot match any SHA256 password. It loads but denies publishing if MediaMTX is started without the override. No deployed secret or hash is committed.

This uses the documented [MediaMTX list environment overrides](https://mediamtx.org/docs/features/configuration) and [hashed credentials](https://mediamtx.org/docs/features/authentication).

## Update on the mini-PC

Run in your existing checkout. The restart interrupts ingest briefly; do it at a suitable time.

```sh
cd ~/openirl
git status --short
git stash list
git pull --ff-only
git log -1 --oneline
```

If tracked files are modified, stop and review them; do not discard changes or pop the old stash. `--ff-only` deliberately refuses conflicting history.

Find the stash with the message `local OpenIRL config before preview update`. Inspect only filenames first:

```sh
git stash show --stat 'stash@{0}'
```

Replace `stash@{0}` below with the actual entry you identified. The helper extracts only the named Feed 1 SHA256 hash without printing it, preserves other `.env` values, makes a mode-600 `.env.before-feed-auth` backup, and leaves the stash intact. It refuses ambiguous/missing hashes, different existing hashes, and overwriting an earlier backup. It accepts the documented block YAML format; for other formats, review the file privately instead of weakening the check.

```sh
python3 scripts/preserve-feed-auth.py 'stash@{0}'
nano .env
```

Add this setting using the **exact name of the OBS audio-capable input carrying Feed 1**, as shown in OBS Sources/Audio Mixer:

```dotenv
OBS_INGEST_AUDIO_SOURCE="Your exact Feed 1 input name"
```

Leave the existing `OBS_WEBSOCKET_PASSWORD` and `OPENIRL_CONTROL_TOKEN` unchanged. The helper adds `FEED_1_PASSWORD_HASH` automatically. If the hash is not in that stash, privately recover the same hash from the deployed config; do not invent a new password or paste it into chat.

Choose the actual media/audio input, not a scene, group, Desktop Audio, or an unrelated microphone. There is no automatic source selection. A healthy mapping means OBS can query that input's mute state; it does not prove its audio routing. Confirm in OBS that this input supplies Feed 1 audio to the intended output tracks. Muting it affects every scene/output using that same input. The HLS preview is upstream of OBS and stays independently muted in the browser.

```sh
chmod 600 .env
docker compose --env-file .env -f docker/compose.yaml --profile srtla config --quiet
docker compose --env-file .env -f docker/compose.yaml --profile srtla up --build -d
docker compose --env-file .env -f docker/compose.yaml --profile srtla ps
python3 scripts/check-feed-auth.py
curl -fsS http://127.0.0.1:8080/api/v1/dashboard/status | jq '{audio, obs: .services.obs, controls}'
```

The auth checker captures configuration privately, checks the container hash against `.env`, and checks the running permission policy. MediaMTX redacts passwords in its API, so this is not a password challenge test. Do not print `docker inspect`, full `compose config`, or raw config API responses when sharing diagnostics.

For the end-to-end publish test, stop the sender, then use IRL Pro with its existing credential and verify Feed 1 becomes online. Temporarily omit credentials, then use an incorrect password: both must fail. Restore the correct password but target `live/feed-2`: that must also fail. Finally restore the original Feed 1 stream ID and verify preview/bitrate recover. Do not put the real credential in shell arguments or screenshots. Do this off-air; stopping the sender avoids confusing authentication rejection with a busy publish path.

## Validate Mute and Unmute

OBS WebSocket remains at `127.0.0.1:4455`; only the backend knows its password. Both POST routes require the existing `X-OpenIRL-Control-Token`, accept no input/source parameters, query `GetInputMute`, issue explicit `SetInputMute`, and read back the result. This follows the [OBS WebSocket protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md). Nothing toggles an arbitrary input.

A missing/wrong token must return HTTP 401, without changing audio:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8080/api/v1/control/ingest/mute
```

The following commands **change live output audio**. Each prompts invisibly for the existing OpenIRL control token; it is not stored or passed in process arguments:

```sh
python3 scripts/ingest-audio.py mute
curl -fsS http://127.0.0.1:8080/api/v1/dashboard/status | jq '.audio'
python3 scripts/ingest-audio.py unmute
curl -fsS http://127.0.0.1:8080/api/v1/dashboard/status | jq '.audio'
```

Expect `muted: true`, then `muted: false`, with `healthy: true` and `enabled: true`. If audio was originally muted, restore that original state after testing. Confirm the OBS mixer and output audio agree. Mute/Unmute buttons reflect status polled every two seconds. External OBS changes appear on the next successful poll. Missing mapping, missing/non-audio input, OBS disconnect, or query failure disables audio controls with a reason. Token errors and rejected/unconfirmed commands appear in the control result. Fix stays disabled.

## Review the stash only after validation

Keep the stash until the auth checker, actual sender checks, preview, and audio checks pass. The helper preserves only the hash, not arbitrary settings from `.env.example` or YAML. Review remaining edits locally in a private terminal:

```sh
git stash list
git stash show --stat 'stash@{0}'
git diff 'stash@{0}^1' 'stash@{0}' -- .env.example integrations/mediamtx/mediamtx.yml
```

That last command may display old credentials: do not share its output. Reapply only useful non-secret settings manually; never blindly `stash pop`. Verify the entry again before dropping it, because stash numbers can change:

```sh
git stash drop 'stash@{0}'
```

Dropping is optional. Keep the private `.env.before-feed-auth` backup until deployment is validated too; `.env*` backups are ignored by Git. Do not commit or upload them.

## Developer validation

```sh
npm ci --ignore-scripts
npm run check
python3 -m unittest discover -s test -p '*_test.py'
# Optional real MediaMTX 1.20.1 binary, using isolated ports and generated credentials:
python3 test/mediamtx-auth-smoke.py /path/to/mediamtx
```

The real-server smoke test checks anonymous/wrong-password denial, valid Feed 1 publishing, cross-feed denial, API/metrics access, and the unconfigured fallback. It uses RTSP to exercise the shared internal authentication policy; mini-PC SRTLA/sender and live OBS checks remain required.
