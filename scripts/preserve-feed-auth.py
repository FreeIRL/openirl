#!/usr/bin/env python3
"""Copy only Feed 1's existing hash from a selected stash into .env; never print it."""
import base64
import os
from pathlib import Path
import re
import subprocess
import sys


def extract_hash(text):
    # Deliberately accept only the documented block YAML shape; fail on ambiguity.
    blocks = re.split(r"(?m)^\s*-\s*user:\s*", text)[1:]
    values = []
    for block in blocks:
        name = block.splitlines()[0].split("#", 1)[0].strip().strip("\"'")
        if name != "openirl-feed-1":
            continue
        match = re.search(r"(?m)^\s+pass:\s*[\"']?(sha256:[A-Za-z0-9+/]+={0,2})[\"']?\s*(?:#.*)?$", block)
        if match:
            value = match[1]
            try:
                valid = len(base64.b64decode(value[7:], validate=True)) == 32
            except ValueError:
                valid = False
            if valid:
                values.append(value)
    if len(values) != 1:
        raise ValueError("Expected exactly one Feed 1 SHA256 hash; review the selected stash privately")
    return values[0]


def preserve(stash):
    if not re.fullmatch(r"stash@\{\d+\}", stash):
        raise ValueError("Select an explicit stash reference, such as stash@{0}")
    result = subprocess.run(["git", "show", f"{stash}:integrations/mediamtx/mediamtx.yml"], capture_output=True, text=True)
    if result.returncode:
        raise ValueError("Could not read that stash's MediaMTX config")
    value = extract_hash(result.stdout)
    path = Path(".env")
    if path.is_symlink() or not path.is_file():
        raise ValueError("Expected an existing regular .env file")
    original = path.read_text()
    entries = re.findall(r"(?m)^\s*(?:export\s+)?FEED_1_PASSWORD_HASH\s*=([^\n]*)$", original)
    if len(entries) > 1:
        raise ValueError("Duplicate FEED_1_PASSWORD_HASH entries; review .env privately")
    if entries and entries[0].strip().strip("\"'") not in ("", value):
        raise ValueError(".env already has a different hash; refusing to overwrite it")
    line = "FEED_1_PASSWORD_HASH=" + value
    updated = re.sub(r"(?m)^\s*(?:export\s+)?FEED_1_PASSWORD_HASH\s*=[^\n]*$", lambda _: line, original) if entries else original.rstrip("\n") + "\n\n" + line + "\n"
    backup = Path(".env.before-feed-auth")
    # Exclusive creation: never overwrite a previous backup.
    with os.fdopen(os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        handle.write(original)
    path.chmod(0o600)
    path.write_text(updated)
    print("Preserved the existing Feed 1 hash in .env; private backup created. Stash untouched.")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("Usage: python3 scripts/preserve-feed-auth.py 'stash@{N}'")
        preserve(sys.argv[1])
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
