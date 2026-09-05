#!/usr/bin/env python3
"""Read effective Compose and running MediaMTX config, reporting no credentials."""
import base64
import json
import subprocess
import sys

COMPOSE = ["docker", "compose", "--env-file", ".env", "-f", "docker/compose.yaml", "--profile", "srtla"]


def captured(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise ValueError("Command failed; check .env, Compose, and running services privately")
    return result.stdout


def verify(config, expected):
    if not expected.startswith("sha256:") or len(base64.b64decode(expected[7:], validate=True)) != 32:
        raise ValueError("FEED_1_PASSWORD_HASH must contain the existing base64 SHA256 digest")
    if config.get("authMethod") != "internal":
        raise ValueError("Running MediaMTX is not using internal authentication")
    users = config.get("authInternalUsers", [])
    publishers = [(u, p) for u in users for p in u.get("permissions", []) if p["action"] == "publish"]
    if len(publishers) != 1:
        raise ValueError("Expected exactly one publish permission")
    user, permission = publishers[0]
    if user["user"] != "openirl-feed-1" or user.get("pass") not in (expected, "<redacted>") or permission.get("path") != "live/feed-1":
        raise ValueError("Feed 1 identity, deployed hash, or publish scope differs from expected")
    if user.get("ips") or user.get("permissions") != [{"action": "publish", "path": "live/feed-1"}]:
        raise ValueError("Feed 1 permissions differ from expected")
    anonymous = [u for u in users if u["user"] == "any"]
    if not any(not u.get("ips") and {p["action"] for p in u["permissions"]} == {"read", "playback"} for u in anonymous):
        raise ValueError("Anonymous read/playback rule differs from expected")
    if not any(set(u.get("ips", [])) == {"127.0.0.1/32", "::1/128", "172.16.0.0/12"} and {p["action"] for p in u["permissions"]} == {"api", "metrics"} for u in anonymous):
        # MediaMTX versions may serialize individual IPs without prefix lengths.
        if not any(set(u.get("ips", [])) == {"127.0.0.1", "::1", "172.16.0.0/12"} and {p["action"] for p in u["permissions"]} == {"api", "metrics"} for u in anonymous):
            raise ValueError("Internal API/metrics rule differs from expected")
    if len(users) != 3:
        raise ValueError("Unexpected additional authentication rules")


if __name__ == "__main__":
    try:
        compose = json.loads(captured(COMPOSE + ["config", "--format", "json"]))
        expected = compose["services"]["mediamtx"]["environment"]["MTX_AUTHINTERNALUSERS_0_PASS"]
        container = captured(COMPOSE + ["ps", "-q", "mediamtx"]).strip()
        if not container or "\n" in container:
            raise ValueError("Expected one running MediaMTX container")
        running = json.loads(captured(["docker", "inspect", container]))[0]
        actual_env = dict(item.split("=", 1) for item in running["Config"]["Env"])
        if actual_env.get("MTX_AUTHINTERNALUSERS_0_PASS") != expected:
            raise ValueError("Running container hash differs from .env; recreate MediaMTX")
        code = 'fetch("http://mediamtx:9997/v3/config/global/get").then(r=>{if(!r.ok)throw Error();return r.text()}).then(t=>process.stdout.write(t)).catch(()=>process.exit(1))'
        config = json.loads(captured(COMPOSE + ["exec", "-T", "stats-bridge", "node", "-e", code]))
        verify(config, expected)
        print("PASS: container Feed 1 hash matches .env; only Feed 1 publishing is authorized; read/playback and internal API/metrics rules preserved.")
    except Exception:
        print("FAIL: could not verify the exact running authentication policy. Check .env and service configuration privately; no credentials printed.", file=sys.stderr)
        sys.exit(1)
