"""The website editor: a small local server that serves the site for previews and a page for editing it.
Only listens on this Mac (127.0.0.1). Started by "Website Editor.app", or by hand:

    python3 tools/editor/server.py            then open http://localhost:8765/_editor/

  /_editor/          the editor page (editor.html)
  /api/...           JSON: list, load and save posts, upload pictures, publish with git
  everything else    the site itself, straight from the repo, for previews
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sitefiles as S  # noqa: E402

PORT = 8765
HERE = os.path.dirname(os.path.abspath(__file__))
FUNCTIONS_COPY = os.path.join(S.ROOT, "..", "Website Functions", "sync-from-git.py")
# Launched from the app, PATH is the bare system one; git's GitHub login (gh) lives in Homebrew.
os.environ["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + os.environ.get("PATH", "")


def git(*args):
    done = subprocess.run(["git", "-C", S.ROOT, *args], capture_output=True, text=True)
    if done.returncode:
        raise ValueError((done.stderr or done.stdout).strip())
    return done.stdout


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=S.ROOT, **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")     # previews always show the file as it is now
        super().end_headers()

    # ---------- plumbing ----------

    def reply(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        return self.rfile.read(int(self.headers.get("Content-Length", 0)))

    def route(self, method):
        url = urlparse(self.path)
        parts = [unquote(p) for p in url.path.strip("/").split("/")]
        try:
            handler = getattr(self, f"{method}_{parts[1]}" if len(parts) > 1 else "", None)
            if handler is None:
                return self.reply({"error": "Not found."}, 404)
            return self.reply(handler(parts[2:], parse_qs(url.query)))
        except ValueError as error:
            return self.reply({"error": str(error)}, 400)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/_editor", "/_editor/"):
            page = open(os.path.join(HERE, "editor.html"), "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(page)))
            self.end_headers()
            return self.wfile.write(page)
        if path.startswith("/api/"):
            return self.route("get")
        if path.startswith("/tools/") or "/." in path:      # the editor's own files and dotfiles aren't the site
            return self.send_error(404)
        return super().do_GET()

    def do_POST(self):
        if not urlparse(self.path).path.startswith("/api/"):
            return self.send_error(404)
        if self.headers.get("Origin") not in (None, f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}"):
            return self.send_error(403)                     # another website can't make this page save or push
        return self.route("post")

    # ---------- API ----------

    def get_list(self, rest, query):
        return {"cards": S.cards(), "projects": S.projects(), "articles": S.articles()}

    def get_post(self, rest, query):
        return S.load_post(rest[0], rest[1])

    def post_post(self, rest, query):
        return {"slug": S.save_post(json.loads(self.body()))}

    def post_delete(self, rest, query):
        S.delete_post(rest[0], rest[1])
        return {}

    def get_article(self, rest, query):
        return S.load_article(rest[0])

    def post_article(self, rest, query):
        S.save_article(json.loads(self.body()))
        return {}

    def post_upload(self, rest, query):
        """A picture or clip for a post: photos shrink to at most 1600 px as JPEG, screenshots stay PNG,
        GIFs and videos are kept as they are. Returns the path to put in the page."""
        folder = re.sub(r"[^\w-]", "", query.get("folder", ["misc"])[0]) or "misc"
        name = os.path.basename(query.get("name", ["file"])[0])
        stem, ext = os.path.splitext(name.lower())
        stem = re.sub(r"[^a-z0-9]+", "-", stem).strip("-") or "file"
        data = self.body()
        if len(data) > 90 * 1024 * 1024:
            raise ValueError("That file is over 90 MB; GitHub refuses files over 100 MB. Shorten or compress it first.")
        target_dir = os.path.join(S.ROOT, "assets", "workshop", folder)
        os.makedirs(target_dir, exist_ok=True)
        keep = ext in (".gif", ".mp4", ".webm", ".mov", ".svg")
        out_ext = ext if keep else (".png" if ext == ".png" else ".jpg")
        target = os.path.join(target_dir, stem + out_ext)
        n = 2
        while os.path.exists(target):
            target = os.path.join(target_dir, f"{stem}-{n}{out_ext}")
            n += 1
        if keep:
            with open(target, "wb") as f:
                f.write(data)
        else:
            raw = target + ".upload"
            with open(raw, "wb") as f:
                f.write(data)
            fmt = ["-s", "format", "png"] if out_ext == ".png" else ["-s", "format", "jpeg", "-s", "formatOptions", "82"]
            done = subprocess.run(["sips", "-Z", "1600", *fmt, raw, "--out", target], capture_output=True)
            os.remove(raw)
            if done.returncode:
                raise ValueError("That file isn't a picture macOS can read.")
        return {"src": "/" + os.path.relpath(target, S.ROOT), "video": out_ext in (".mp4", ".webm", ".mov")}

    def get_status(self, rest, query):
        changed = [line[3:] for line in git("status", "--porcelain").splitlines()]
        return {"changed": changed, "last": git("log", "-1", "--format=%h %s").strip()}

    def post_publish(self, rest, query):
        message = (json.loads(self.body() or b"{}").get("message") or "Edit the site").strip()
        if not git("status", "--porcelain").strip():
            raise ValueError("Nothing to publish: no changes since the last publish.")
        git("add", "-A")
        git("commit", "-q", "-m", message)
        git("pull", "--rebase", "-q")                       # in case the site was changed somewhere else
        git("push", "-q")
        if os.path.exists(FUNCTIONS_COPY):                  # keep the placeholder copy in step
            subprocess.run([sys.executable, FUNCTIONS_COPY], capture_output=True)
        return {"last": git("log", "-1", "--format=%h %s").strip()}

    def post_discard(self, rest, query):
        """Throws away every change since the last publish."""
        git("checkout", "--", ".")
        git("clean", "-fdq", "--", "updates", "projects", "assets/workshop")
        return {}

    def post_quit(self, rest, query):
        threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0))).start()
        return {}


def main():
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print(f"Already running: http://localhost:{PORT}/_editor/")
        return
    print(f"Website editor: http://localhost:{PORT}/_editor/")
    server.serve_forever()


if __name__ == "__main__":
    main()
