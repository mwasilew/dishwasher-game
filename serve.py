#!/usr/bin/env python3
"""
Development server for Dishwasher Packing.

The same thing as `python3 -m http.server`, with one difference that matters: it tells
the browser never to cache anything. Chrome holds on to ES modules hard, and a plain
reload will happily re-run a copy of the game from ten minutes ago — which looks
exactly like a bug that refuses to be fixed.

    python3 serve.py [port]        # default 8000
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_head(self):
        # strip the browser's conditional headers so we can never answer "use your copy"
        for header in ("If-Modified-Since", "If-None-Match"):
            while header in self.headers:
                del self.headers[header]
        return super().send_head()

    def log_message(self, fmt, *args):
        msg = fmt % args
        if ' 200 ' in msg or ' 304 ' in msg:
            return                                    # only shout about problems
        sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), msg))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = http.server.ThreadingHTTPServer(("", port), NoCacheHandler)
    print(f"Dishwasher Packing  ->  http://localhost:{port}")
    print("caching disabled; Ctrl-C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
