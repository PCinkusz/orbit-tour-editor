#!/usr/bin/env python3
"""Tiny static server for this tour folder. Python 3.7+, no packages."""
import os, re, sys, socket, subprocess, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote

ROOT = os.path.dirname(os.path.abspath(__file__))
MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
}

def arg(name, default):
    a = sys.argv[1:]
    if name in a:
        i = a.index(name)
        if i + 1 < len(a):
            return a[i + 1]
    return default

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'TourServe'

    def log_message(self, *a):
        pass

    def _text(self, code, text):
        body = text.encode()
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _serve(self, head):
        try:
            rel = unquote(urlsplit(self.path).path)
        except Exception:
            return self._text(400, 'Bad request')
        if '\0' in rel:
            return self._text(400, 'Bad request')
        if rel.endswith('/'):
            rel += 'index.html'
        full = os.path.realpath(os.path.join(ROOT, *[p for p in rel.split('/') if p]))
        real_root = os.path.realpath(ROOT)
        if full != real_root and not full.startswith(real_root + os.sep):
            return self._text(403, 'Forbidden')
        if not os.path.isfile(full):
            return self._text(404, 'Not found')
        size = os.path.getsize(full)
        start, end, code = 0, size - 1, 200
        headers = {
            'Content-Type': MIME.get(os.path.splitext(full)[1].lower(), 'application/octet-stream'),
            'Accept-Ranges': 'bytes',
        }
        if os.path.basename(full) in ('index.html', 'tour.json'):
            headers['Cache-Control'] = 'no-cache'
        rng = self.headers.get('Range')
        if rng:
            m = re.match(r'^bytes=(\d*)-(\d*)$', rng.strip())
            ok = bool(m) and (m.group(1) != '' or m.group(2) != '')
            if ok:
                if m.group(1) == '':
                    start = max(0, size - int(m.group(2)))
                else:
                    start = int(m.group(1))
                    if m.group(2) != '':
                        end = min(end, int(m.group(2)))
                ok = start < size and start <= end
            if not ok:
                self.send_response(416)
                self.send_header('Content-Range', 'bytes */%d' % size)
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            code = 206
            headers['Content-Range'] = 'bytes %d-%d/%d' % (start, end, size)
        length = end - start + 1 if size else 0
        headers['Content-Length'] = str(length)
        self.send_response(code)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        if head or length == 0:
            return
        try:
            with open(full, 'rb') as f:
                f.seek(start)
                left = length
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def do_GET(self):
        self._serve(False)

    def do_HEAD(self):
        self._serve(True)

    def _other(self):
        self._text(405, 'Method not allowed')
    do_POST = do_PUT = do_DELETE = do_PATCH = _other

class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

def main():
    host = arg('--host', '127.0.0.1')
    port = int(arg('--port', '8080'))
    httpd = None
    for p in range(port, port + 21):
        try:
            httpd = Server((host, p), Handler)
            port = p
            break
        except OSError:
            continue
    if httpd is None:
        print('Could not find a free port.')
        sys.exit(1)
    shown = 'localhost' if host in ('127.0.0.1', '0.0.0.0', '::') else host
    url = 'http://%s:%d' % (shown, port)
    print('Tour is running at ' + url, flush=True)
    print('Leave this window open while you watch. Press Ctrl+C to stop.', flush=True)
    if '--no-open' not in sys.argv:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == '__main__':
    main()
