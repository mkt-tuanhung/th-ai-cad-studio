# QA for Settings → Download AI model: run with THCAD_MODEL_MIRROR=http://127.0.0.1:18765 (port 8765 is taken on the dev Mac).
# usage: MODE=ok|drop|corrupt [DROP_AT=bytes] [THROTTLE=bytes/s] python3 qa/tools/model_mirror.py <dir with the .gguf files (+ .bad copies)> 18765
# QA mirror for the model downloader: serves <root>/<repo>/resolve/main/<file> with HTTP Range.
# Modes (env MODE): ok | drop (first request of each file is cut after DROP_AT bytes) | corrupt (served from <file>.bad)
import http.server, os, sys, re, time
root, port = sys.argv[1], int(sys.argv[2])
MODE = os.environ.get('MODE', 'ok'); DROP_AT = int(os.environ.get('DROP_AT', str(300 << 20)))
seen = set(); log = open(os.path.join(root, 'requests.log'), 'a')
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        m = re.match(r'^/(.+)/resolve/main/(.+)$', self.path)
        path = os.path.join(root, m.group(2)) if m else ''
        if MODE == 'corrupt': path += '.bad'
        if not m or not os.path.exists(path):
            log.write(f'404 {self.path}\n'); log.flush(); self.send_error(404); return
        size = os.path.getsize(path); start = 0
        rng = self.headers.get('Range')
        if rng:
            start = int(re.match(r'bytes=(\d+)-', rng).group(1))
            if start >= size: self.send_error(416); return
            self.send_response(206); self.send_header('Content-Range', f'bytes {start}-{size-1}/{size}')
        else: self.send_response(200)
        self.send_header('Content-Length', str(size - start)); self.end_headers()
        log.write(f'GET {m.group(2)} range={rng} start={start}\n'); log.flush()
        drop = MODE == 'drop' and path not in seen
        seen.add(path)
        sent = 0
        with open(path, 'rb') as f:
            f.seek(start)
            while True:
                b = f.read(1 << 20)
                if not b: break
                try: self.wfile.write(b)
                except Exception: return
                sent += len(b)
                if os.environ.get('THROTTLE'): time.sleep(len(b) / float(os.environ['THROTTLE']))
                if drop and sent >= DROP_AT:
                    log.write(f'DROP {m.group(2)} after {sent}\n'); log.flush()
                    self.connection.shutdown(2); return
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
