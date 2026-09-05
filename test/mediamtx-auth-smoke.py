#!/usr/bin/env python3
"""Optional real-server check: python3 test/mediamtx-auth-smoke.py /path/to/mediamtx"""
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


def port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def announce(rtsp_port, path, password=None):
    sdp = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=test\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 packetization-mode=1\r\na=control:trackID=0\r\n"
    auth = ""
    if password is not None:
        auth = "Authorization: Basic " + base64.b64encode(("openirl-feed-1:" + password).encode()).decode() + "\r\n"
    request = f"ANNOUNCE rtsp://127.0.0.1:{rtsp_port}/{path} RTSP/1.0\r\nCSeq: 1\r\n{auth}Content-Type: application/sdp\r\nContent-Length: {len(sdp)}\r\n\r\n{sdp}"
    with socket.create_connection(("127.0.0.1", rtsp_port), timeout=5) as s:
        s.sendall(request.encode())
        response = s.recv(4096)
        return int(response.split(b" ")[1])


def run(binary, configured):
    api_port, rtsp_port, metrics_port = port(), port(), port()
    secret = secrets.token_hex(24)
    digest = "sha256:" + base64.b64encode(hashlib.sha256(secret.encode()).digest()).decode()
    env = {k:v for k,v in os.environ.items() if not k.startswith("MTX_")}
    env.update(MTX_APIADDRESS=f"127.0.0.1:{api_port}", MTX_METRICSADDRESS=f"127.0.0.1:{metrics_port}", MTX_RTSPADDRESS=f"127.0.0.1:{rtsp_port}", MTX_RTSPTRANSPORTS="tcp", MTX_RTMP="no", MTX_SRT="no", MTX_HLS="no", MTX_WEBRTC="no", MTX_MOQ="no")
    if configured:
        env["MTX_AUTHINTERNALUSERS_0_PASS"] = digest
    with tempfile.TemporaryFile() as log:
        process = subprocess.Popen([binary, "integrations/mediamtx/mediamtx.yml"], env=env, stdout=log, stderr=log)
        try:
            for _ in range(50):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{api_port}/v3/config/global/get", timeout=1) as r:
                        config = json.load(r)
                    break
                except OSError:
                    if process.poll() is not None:
                        raise RuntimeError("MediaMTX did not start")
                    time.sleep(.1)
            else:
                raise RuntimeError("MediaMTX readiness timed out")
            if configured:
                sys.path.insert(0, str(Path("scripts").resolve()))
                from importlib import import_module
                import_module("check-feed-auth").verify(config, digest)
            with urllib.request.urlopen(f"http://127.0.0.1:{metrics_port}/metrics") as r:
                assert r.status == 200
            assert announce(rtsp_port, "live/feed-1") == 401, "anonymous publish accepted"
            assert announce(rtsp_port, "live/feed-1", "incorrect") == 401, "wrong password accepted"
            assert announce(rtsp_port, "live/feed-2", secret) == 401, "cross-feed publish accepted"
            assert announce(rtsp_port, "live/feed-1", secret) == (200 if configured else 401), "Feed 1 credential result incorrect"
            print("PASS: real MediaMTX " + ("hash override and publish scope" if configured else "unconfigured fallback denies all publishing"))
        finally:
            process.terminate()
            process.wait(timeout=5)


if __name__ == "__main__":
    run(str(Path(sys.argv[1]).resolve()), True)
    run(str(Path(sys.argv[1]).resolve()), False)
