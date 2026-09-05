# OpenIRL dashboard and multi-ingest audit

Audited upstream commit `221d3c4` (2026-09-05). Changes are implemented in this local checkout; nothing has been pushed or deployed. Scope: the current plain-JavaScript dashboard, production registry/controller, snapshot scheduler, authentication, OBS client/recovery, metrics, Compose overlays, and associated tests.

Severity: P1 = production/security risk; P2 = significant operator disruption; P3 = smaller usability or maintenance issue. Findings below are code-based, not claims that the running installation has experienced every failure.

## Implemented fixes

| Severity | Finding and trigger | Implemented fix | Location |
|---|---|---|---|
| P1 | Service notes and state were interpolated into HTML attributes without escaping. An upstream string containing markup could affect the dashboard DOM, where a control token is entered. | Escape the dynamic attribute values before rendering. No token persistence added. | `public/app.js` |
| P1 | An authenticated direct `select-profile` API request bypassed Take Live's ownership and OBS scene validation. | Reject direct HTTP selection; keep internal registry selection available to the validated controller. | `src/multi-ingest.js` |
| P1 | A manual scene request could race an automatic transition or Take Live. Failed Take Live unpaused automation before the OBS operation succeeded. | Share the controller's working guard for manual scenes; clear its candidate and pause. Resume automation only after a successful Take Live. | `src/feed-health.js`, `src/server.js` |
| P2 | The multi-ingest constructor still defaulted to RTMP, despite the working SRT snapshot implementation. Connection details also recommended RTMP for OBS, which can lose HEVC video. | Default and generated local OBS source now use `srt://127.0.0.1:8890?streamid=read:live/...`. Existing OBS inputs are not changed. | `src/multi-ingest.js` |
| P2 | Opening any editor, viewing credentials, or retaining focus froze all feed and profile telemetry. Operators could continue seeing ONLINE while a feed was lost. | Continue polling and update live health/preview fields in place while preserving form DOM, drafts and displayed configuration revision. Flag concurrent registry changes. | `public/feeds.js` |
| P2 | Network/auth failures were silently ignored by the feed manager; the main dashboard retained a Live stream badge on connection loss. Polls could overlap indefinitely. | Single in-flight status polls with deadlines, explicit loss-of-connection indicators, feed control disabling, and Access redirect/non-JSON handling. | `public/feeds.js`, `public/app.js` |
| P2 | OBS and audio buttons were enabled with no entered token. After an action, Start and Stop could both become enabled regardless of streaming state. | Apply token, busy and stream-state gates consistently. Gate feed mutation and credential controls too. | `public/app.js`, `public/feeds.js` |
| P2 | Last successful snapshots never became stale, and recovery treated old JPEGs as current preview evidence. | Expose a 30-second stale flag, label old frames, and exclude stale previews from successful recovery evidence. Replace HLS-only recovery wording. Retain the last frame intentionally. | `src/snapshots.js`, `src/recovery.js`, dashboard scripts |
| P2 | Disabling a feed persisted the change but returned a failure when the subsequent MediaMTX kick failed, encouraging misleading retries. | Return saved state with an explicit pending-disconnect warning; preserve automatic reconciliation. Reject obviously stale/unconfirmed delete/rotate requests before attempting a disconnect. | `src/multi-ingest.js` |
| P2 | Unhandled rejected top-level HTTP handlers could escape the server request boundary. | Add a sanitized 500 response or destroy an already-started response on rejection. | `src/server.js` |
| P2 | The 280px minimum feed grid plus nested padding could overflow narrow phones; form controls used small text and previews lacked height constraints. Resizing while using the mobile keyboard collapsed the scene card. | Allow the grid to shrink, constrain fields/images, use 16px token text and 44px controls, account for safe-area footer space, and only reset scene-card state when crossing the layout breakpoint. | `public/styles.css`, `public/app.js` |
| P3 | Mobile hid all system status, showed a disabled menu, and repeated connection-detail clicks accumulated secret panels. | Show compact mobile system status, hide the nonfunctional menu, and replace previous credential panels. | `public/styles.css`, `public/feeds.js` |

Paths in this table are relative to `apps/dashboard/`.

## Remaining issues and recommended next changes

| Severity | Finding | Recommended fix |
|---|---|---|
| P2 | Each dashboard status request performs multiple OBS queries through recovery diagnosis, including preview work. Multiple viewers amplify this load; slow OBS can make dashboard status fail despite healthy ingest. | Cache/coalesce short-lived status and recovery diagnostics server-side. Keep recovery mutation guards fresh immediately before writes. |
| P2 | Take Live persists the selected profile before its OBS scene change. Failure is now safely paused, but the selected label can describe an unapplied profile. | Expose an explicit failed/pending take result, or implement rollback with revision checks. Do not blindly roll back concurrent registry changes. |
| P2 | Delete/rotate checks, external publisher disconnect and the registry mutation are not one serialized operation. Another operator can change state while disconnect is awaited. | Serialize the whole production operation, revalidate inside that boundary, and reject stale intent before external effects. Current registry revision checks prevent a stale write, but do not make the external kick transactional. |
| P2 | Public protocol connection details use fixed default ports and list configured protocols even when the corresponding external listener/firewall is not reachable. | Add explicit advertised-port configuration and distinguish enabled publishing permissions from verified reachability. Keep direct SRT/RTMP opt-in and private control ports unchanged. |
| P2 | Recovery intentionally only supports the configured Feed 1 Media Source in the literal `Live` scene. It does not recover arbitrary production profiles. | Show this limitation next to Fix and implement per-profile recovery only with explicit source mapping and equivalent safety checks. |
| P3 | Snapshot capture already in flight when a feed is deleted can briefly repopulate its in-memory frame before the next prune. Registry checks prevent serving it for a deleted feed. | Invalidate in-flight captures with a generation/cancellation token when pruning. |
| P3 | The chart says 60 seconds but stores 60 samples at a two-second polling interval; it spans roughly two minutes and does not position samples by timestamp. | Draw timestamped samples over a fixed 60-second window and display missing telemetry as gaps. |
| P3 | Configuration conflicts are explained, but the UI has no explicit reload/discard button, automatic draft recovery, or durable operation history. Mutation timeouts cannot prove whether a command completed. | Add a deliberate reload action, preserve drafts across it, and add operation IDs/status for retries. Never automatically retry stream or destructive operations. |

## Security and compatibility boundaries retained

- The working Compose `OPENIRL_SNAPSHOT_SOURCE` SRT override and indexed `MTX_AUTHHTTPEXCLUDE_0_ACTION: api` / `_1_ACTION: metrics` are unchanged.
- Feed 1 ID, existing password hash, publisher credentials, registry migration, SRTLA forwarding, and local read authentication are unchanged.
- Automation ownership configuration is unchanged. The controller still only automates scenes when the owner is `openirl`; this patch does not start NOALBS or change the live owner's setting.
- OBS websocket, dashboard origin, MediaMTX API/metrics and auth listener bindings remain private. No ports, tunnel routes, firewall rules, certificates, or deployment secrets were changed.
- Dashboard reads and JPEGs deliberately rely on the existing Cloudflare Access boundary; the control token separately protects mutations and credential retrieval. The running Access application and policy were not inspected. Verify the policy covers the entire hostname, including API and snapshot paths; this patch does not add a second login system.
- Control tokens remain memory/input-only and credential APIs retain no-store responses. Existing generated feed secrets remain in the restricted registry file by design.

## Validation

`npm run check`: 55 passed, 2 skipped, 0 failed across root, dashboard and stats bridge checks. The skipped suites are environment-dependent HTTPS and real MediaMTX runtime tests. Python credential-preservation tests: 2 passed. `git diff --check`: passed.

New regression tests exercise: feed telemetry updates without losing an open editor draft; token and network-loss control gating; HEVC-compatible local SRT default and generated OBS URL; rejection of direct profile selection; failed Take Live staying paused; concurrent manual scene rejection; snapshot staleness; and saved-disable/pending-disconnect responses. Existing Feed 1 authentication, recovery, metrics and control tests also pass.

Limitations: no live OBS, MediaMTX, two-publisher session, Cloudflare Access session or physical mobile browser was used. Browser visual QA used the actual dashboard HTML/CSS/JavaScript with a loopback-only simulated backend at 1280px, 390px and 320px widths. Physical-device and live Cloudflare verification remain outstanding. Before deployment, review the patch and run the existing optional runtime tests where the media stack is available. Then verify Feed 1 HEVC preview, token operations, editor telemetry updates, mobile background/resume, expired Access login, and Take Live/BRB behavior on the actual installation.

## Applying the patch

The companion patch is based on commit `221d3c4` and includes this report and tests. In the deployment repo, review current local changes, run `git apply --check /path/to/openirl-dashboard-audit.patch`, then `git apply /path/to/openirl-dashboard-audit.patch`. Run `npm run check` before rebuilding. The implementation changes only dashboard application files and documentation; no Compose recreation or remote deployment was performed during this audit.


## Visual verification follow-up

Visually inspected desktop and phone-width dashboard, open feed/profile editors, credential reveal, disabled controls, stale snapshots and simulated connection loss. Read-only DOM measurements found no horizontal overflow at 320px. The final desktop reload produced no browser console errors.

Additional fixes from the visual pass:

- P2: On connection loss, the green footer bitrate, last-update wording, scene badge and profile health could still look current. These now explicitly show unavailable/stale states, with regression assertions for the footer, scene and telemetry label.
- P2: Narrow ingest headers squeezed feed identity and long offline badges together. Header wrapping now keeps them readable.
- P3: Feed forms relied on browser-default dark fields and weak button contrast. Explicit light fields, contrasting buttons, focus outlines and larger checkbox/tap rows improve readability and operation.
- P3: Opening an editor stretched the adjacent desktop feed card to the entire editor height. Cards now align to the top independently.

Screenshots are supplied with the audit: `dashboard-mobile-editor.png` (320px profile editor), `dashboard-mobile-offline.png` (390px connection loss), and `dashboard-desktop-feeds.png` (desktop feeds). They show synthetic data and a test-only image, not the live broadcast. The local visual fixture is a scratch verification tool and is not included in the deployment patch.
