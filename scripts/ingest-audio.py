#!/usr/bin/env python3
"""Operate the guarded dashboard using a hidden token prompt (never OBS directly)."""
import getpass
import json
import sys
import urllib.error
import urllib.request

if len(sys.argv) != 2 or sys.argv[1] not in ("mute", "unmute"):
    sys.exit("Usage: python3 scripts/ingest-audio.py mute|unmute")
token = getpass.getpass("OpenIRL control token (hidden): ")
request = urllib.request.Request("http://127.0.0.1:8080/api/v1/control/ingest/" + sys.argv[1], data=b"{}", headers={"Content-Type":"application/json", "X-OpenIRL-Control-Token":token}, method="POST")
try:
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.load(response)
    print("Confirmed: main ingest audio is " + ("muted" if result["audio"]["muted"] else "unmuted"))
except urllib.error.HTTPError as error:
    print(f"Control failed (HTTP {error.code}); check dashboard audio status", file=sys.stderr)
    sys.exit(1)
except (OSError, ValueError, KeyError):
    sys.exit("Could not confirm mute state; refresh dashboard status before retrying")
