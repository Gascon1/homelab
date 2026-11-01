#!/usr/bin/env python3
"""Push-deploy doorbell (see docs/deploy.md).

POST /deploy  body {"sha": "<40 hex>", "ts": <unix seconds>}
              header X-Signature-256: sha256=<hex HMAC-SHA256(secret, raw body)>
On a valid request it writes "<sha> <ts>\\n" to $TRIGGER_DIR/trigger (atomically).
A systemd path unit watches that file and starts scripts/deploy.sh, which does
all the real checks. This service carries no authority: a forged or replayed
request can at worst cause one extra, harmless deploy check.
Env: DEPLOY_HOOK_SECRET (>= 32 chars, required), PORT (9000), TRIGGER_DIR (/trigger).
"""
import hashlib
import hmac
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 1024  # bytes
MAX_SKEW = 300  # seconds, either direction
MIN_GAP = 10  # seconds between rewrites of the trigger file
MIN_SECRET = 32
SHA_RE = re.compile(r"[0-9a-f]{40}")
READ_TIMEOUT = 10  # seconds per socket read: a slow or stalled client cannot hold a thread
# Client-controlled text (method, path) goes to the log: escape control characters
LOG_SAFE = {c: f"\\x{c:02x}" for c in [*range(0x20), 0x7f]}


class Hook(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, addr, secret, trigger_dir):
        if len(secret or "") < MIN_SECRET:
            raise ValueError(f"DEPLOY_HOOK_SECRET must be at least {MIN_SECRET} characters")
        super().__init__(addr, Handler)
        self.secret = secret.encode()
        self.trigger = os.path.join(trigger_dir, "trigger")
        self.last_write = None  # time.monotonic() of the last accepted request
        self.lock = threading.Lock()  # one writer at a time: the tmp name is shared
        if not os.access(trigger_dir, os.W_OK):
            print(f"deploy-hook: WARNING {trigger_dir} is not writable; requests will get 500 "
                  "(run ./setup.sh, it makes the folder)", file=sys.stderr, flush=True)

    def accept(self, sha, ts):
        with self.lock:
            now = time.monotonic()
            if self.last_write is not None and now - self.last_write < MIN_GAP:
                return
            tmp = self.trigger + ".tmp"
            with open(tmp, "w") as f:
                f.write(f"{sha} {ts}\n")
            os.replace(tmp, self.trigger)
            self.last_write = now


class Handler(BaseHTTPRequestHandler):
    server_version = "deploy-hook"
    sys_version = ""
    timeout = READ_TIMEOUT

    def reply(self, code, note=""):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(note) + 1))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write((note + "\n").encode())
        if self.path != "/healthz":  # the healthcheck would bury the real requests
            self.log_message("%s %s -> %d %s", self.command, self.path, code, note)

    def do_GET(self):
        if self.command == "GET" and self.path == "/healthz":
            self.reply(200, "ok")
        elif self.path == "/deploy":
            self.reply(405, "use POST")
        else:
            self.reply(404, "not found")

    do_HEAD = do_PUT = do_DELETE = do_PATCH = do_GET

    def do_POST(self):
        if self.path != "/deploy":
            return self.reply(404, "not found")
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self.reply(411, "length required")
        if length < 0 or length > MAX_BODY:
            return self.reply(413, "body too large")
        try:
            body = self.rfile.read(length)
        except TimeoutError:
            self.close_connection = True
            return self.log_message("%s %s -> body read timed out", self.command, self.path)
        want = "sha256=" + hmac.new(self.server.secret, body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(want, self.headers.get("X-Signature-256", "")):
            return self.reply(401, "bad signature")
        try:
            data = json.loads(body)
            sha, ts = data["sha"], data["ts"]
            if not isinstance(sha, str) or not SHA_RE.fullmatch(sha):
                return self.reply(400, "bad sha")
            if isinstance(ts, bool) or not isinstance(ts, int):
                return self.reply(400, "bad ts")
        except (ValueError, KeyError, TypeError):
            return self.reply(400, "bad body")
        if abs(int(time.time()) - ts) > MAX_SKEW:  # ints only: a huge ts cannot overflow a float
            return self.reply(401, "stale ts")
        try:
            self.server.accept(sha, ts)
        except OSError as e:
            self.log_message("cannot write trigger: %s", e.strerror)  # detail in the log, not the reply
            return self.reply(500, "cannot write trigger")
        self.reply(202, "accepted")

    def log_request(self, code="-", size="-"):
        pass  # reply() logs the one line per request

    def log_message(self, fmt, *args):  # one line per request, never the secret
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), (fmt % args).translate(LOG_SAFE)))


def main():
    try:
        srv = Hook(("0.0.0.0", int(os.environ.get("PORT", "9000"))),
                   os.environ.get("DEPLOY_HOOK_SECRET", ""),
                   os.environ.get("TRIGGER_DIR", "/trigger"))
    except ValueError as e:
        sys.exit(f"deploy-hook: {e}")
    print(f"deploy-hook listening on :{srv.server_port}", file=sys.stderr, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
