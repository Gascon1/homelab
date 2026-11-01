"""Tests for hook.py. Run: python3 -m unittest deploy-hook/test_hook.py -v"""
import hashlib
import hmac
import http.client
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import socket
import time
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hook  # noqa: E402

SECRET = "s" * 40
SHA = "a" * 40
SHA2 = "b" * 40


def sign(body, secret=SECRET):
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


class HookTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.srv = hook.Hook(("127.0.0.1", 0), SECRET, self.dir.name)
        self.thread = threading.Thread(target=self.srv.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.thread.start()
        self.trigger = os.path.join(self.dir.name, "trigger")

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.dir.cleanup()

    def request(self, method="POST", path="/deploy", body=b"", sig=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.srv.server_port, timeout=5)
        h = dict(headers or {})
        if sig is not None:
            h["X-Signature-256"] = sig
        c.request(method, path, body=body if method == "POST" else None, headers=h)
        r = c.getresponse()
        r.read()
        c.close()
        return r.status

    def post(self, sha=SHA, ts=None, secret=SECRET, raw=None):
        body = raw if raw is not None else json.dumps(
            {"sha": sha, "ts": int(time.time()) if ts is None else ts}).encode()
        return self.request(body=body, sig=sign(body, secret)), body

    def test_good_signature_writes_file(self):
        ts = int(time.time())
        status, _ = self.post(ts=ts)
        self.assertEqual(status, 202)
        with open(self.trigger) as f:
            self.assertEqual(f.read(), f"{SHA} {ts}\n")
        self.assertEqual(os.listdir(self.dir.name), ["trigger"])  # no tmp file left

    def test_bad_signature(self):
        status, _ = self.post(secret="x" * 40)
        self.assertEqual(status, 401)
        self.assertFalse(os.path.exists(self.trigger))

    def test_missing_or_malformed_signature(self):
        body = json.dumps({"sha": SHA, "ts": int(time.time())}).encode()
        self.assertEqual(self.request(body=body), 401)
        self.assertEqual(self.request(body=body, sig=sign(body)[len("sha256="):]), 401)
        self.assertFalse(os.path.exists(self.trigger))

    def test_signature_covers_body(self):
        body = json.dumps({"sha": SHA, "ts": int(time.time())}).encode()
        other = json.dumps({"sha": SHA2, "ts": int(time.time())}).encode()
        self.assertEqual(self.request(body=other, sig=sign(body)), 401)

    def test_stale_and_future_ts(self):
        self.assertEqual(self.post(ts=int(time.time()) - 301)[0], 401)
        self.assertEqual(self.post(ts=int(time.time()) + 301)[0], 401)
        self.assertFalse(os.path.exists(self.trigger))
        self.assertEqual(self.post(ts=int(time.time()) - 290)[0], 202)

    def test_oversize_body(self):
        body = json.dumps({"sha": SHA, "ts": int(time.time()), "pad": "x" * 1100}).encode()
        self.assertGreater(len(body), 1024)
        try:
            status = self.request(body=body, sig=sign(body))
        except (ConnectionError, http.client.HTTPException):
            status = 413  # server answered and closed before the client finished sending
        self.assertEqual(status, 413)
        self.assertFalse(os.path.exists(self.trigger))

    def test_bad_sha(self):
        for sha in ("a" * 39, "A" * 40, "g" * 40, "", "a" * 41):
            self.assertEqual(self.post(sha=sha)[0], 400, sha)
        self.assertEqual(self.post(raw=b'{"sha": 5, "ts": 1}')[0], 400)
        self.assertEqual(self.post(raw=b"not json")[0], 400)
        self.assertEqual(self.post(raw=json.dumps({"sha": SHA, "ts": "now"}).encode())[0], 400)
        self.assertFalse(os.path.exists(self.trigger))

    def test_wrong_path_and_method(self):
        body = json.dumps({"sha": SHA, "ts": int(time.time())}).encode()
        self.assertEqual(self.request(path="/other", body=body, sig=sign(body)), 404)
        self.assertEqual(self.request(path="/deploy/", body=body, sig=sign(body)), 404)
        self.assertEqual(self.request(method="GET", path="/deploy"), 405)
        self.assertEqual(self.request(method="PUT", path="/deploy"), 405)
        self.assertEqual(self.request(method="PUT", path="/healthz"), 404)
        self.assertEqual(self.request(method="GET", path="/"), 404)
        self.assertFalse(os.path.exists(self.trigger))

    def test_rate_limit(self):
        self.assertEqual(self.post(sha=SHA)[0], 202)
        mtime = os.stat(self.trigger).st_mtime_ns
        self.assertEqual(self.post(sha=SHA2)[0], 202)  # accepted but not rewritten
        with open(self.trigger) as f:
            self.assertTrue(f.read().startswith(SHA))
        self.assertEqual(os.stat(self.trigger).st_mtime_ns, mtime)
        self.srv.last_write -= hook.MIN_GAP + 1  # pretend 10 s passed
        self.assertEqual(self.post(sha=SHA2)[0], 202)
        with open(self.trigger) as f:
            self.assertTrue(f.read().startswith(SHA2))

    def test_healthz(self):
        self.assertEqual(self.request(method="GET", path="/healthz"), 200)

    def test_unwritable_dir_is_500(self):
        self.srv.trigger = os.path.join(self.dir.name, "missing", "trigger")
        with mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            body = json.dumps({"sha": SHA, "ts": int(time.time())}).encode()
            c = http.client.HTTPConnection("127.0.0.1", self.srv.server_port, timeout=5)
            c.request("POST", "/deploy", body=body, headers={"X-Signature-256": sign(body)})
            r = c.getresponse()
            self.assertEqual(r.status, 500)
            self.assertEqual(r.read(), b"cannot write trigger\n")  # no OS detail in the reply
            c.close()
        self.assertIn("No such file or directory", err.getvalue())  # the detail is in the log

    def test_slow_body_times_out(self):
        # Slowloris: a client that announces a body and never sends it must not hold a thread
        self.assertTrue(hook.Handler.timeout and hook.Handler.timeout <= 30)
        with mock.patch.object(hook.Handler, "timeout", 0.3), \
                mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            s = socket.create_connection(("127.0.0.1", self.srv.server_port), timeout=5)
            s.sendall(b"POST /deploy HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\n{")
            self.assertEqual(s.recv(100), b"")  # server closed the connection
            s.close()
        self.assertIn("body read timed out", err.getvalue())
        self.assertNotIn("Traceback", err.getvalue())
        self.assertFalse(os.path.exists(self.trigger))

    def test_missing_or_negative_length(self):
        body = json.dumps({"sha": SHA, "ts": int(time.time())}).encode()
        for cl in (None, "-1", "abc"):
            s = socket.create_connection(("127.0.0.1", self.srv.server_port), timeout=5)
            head = b"POST /deploy HTTP/1.1\r\nHost: x\r\nX-Signature-256: " + sign(body).encode() + b"\r\n"
            if cl is not None:
                head += b"Content-Length: " + cl.encode() + b"\r\n"
            s.sendall(head + b"\r\n" + body)
            status = s.recv(100).split(b" ")[1]
            s.close()
            self.assertIn(status, (b"411", b"413"), cl)
        # chunked without Content-Length is refused, not parsed
        s = socket.create_connection(("127.0.0.1", self.srv.server_port), timeout=5)
        s.sendall(b"POST /deploy HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n"
                  + b"%x\r\n" % len(body) + body + b"\r\n0\r\n\r\n")
        self.assertEqual(s.recv(100).split(b" ")[1], b"411")
        s.close()
        self.assertFalse(os.path.exists(self.trigger))

    def test_huge_ts_is_rejected_not_crashed(self):
        self.assertEqual(self.post(raw=json.dumps({"sha": SHA, "ts": 10 ** 400}).encode())[0], 401)

    def test_log_escapes_control_chars_and_skips_healthz(self):
        with mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            s = socket.create_connection(("127.0.0.1", self.srv.server_port), timeout=5)
            s.sendall(b"GET /x\x1b[31m\x07 HTTP/1.1\r\nHost: x\r\n\r\n")
            self.assertEqual(s.recv(100).split(b" ")[1], b"404")
            s.close()
            self.assertEqual(self.request(method="GET", path="/healthz"), 200)
        log = err.getvalue()
        self.assertNotIn("\x1b", log)
        self.assertIn("\\x1b[31m\\x07", log)
        self.assertNotIn("healthz", log)
        self.assertEqual(len(log.splitlines()), 1)

    def test_concurrent_posts_write_once(self):
        results = []
        threads = [threading.Thread(target=lambda: results.append(self.post()[0])) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(results, [202] * 8)
        self.assertEqual(os.listdir(self.dir.name), ["trigger"])


class StartupTest(unittest.TestCase):
    def run_main(self, secret):
        env = {k: v for k, v in os.environ.items() if k != "DEPLOY_HOOK_SECRET"}
        if secret is not None:
            env["DEPLOY_HOOK_SECRET"] = secret
        return subprocess.run([sys.executable, os.path.join(HERE, "hook.py")], env=env,
                              capture_output=True, text=True, timeout=10)

    def test_short_or_empty_secret_refused(self):
        for secret in (None, "", "short", "x" * 31):
            r = self.run_main(secret)
            self.assertNotEqual(r.returncode, 0, repr(secret))
            self.assertIn("at least 32", r.stderr)

    def test_warns_when_dir_not_writable(self):
        with mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            srv = hook.Hook(("127.0.0.1", 0), SECRET, os.path.join(tempfile.gettempdir(), "no-such-dir-x"))
            srv.server_close()
        self.assertIn("not writable", err.getvalue())

    def test_class_refuses_short_secret(self):
        with self.assertRaises(ValueError):
            hook.Hook(("127.0.0.1", 0), "x" * 31, tempfile.gettempdir())


if __name__ == "__main__":
    unittest.main()
