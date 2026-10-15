"""Reads and writes the site's own files for the editor (server.py). Everything here works on the
HTML as it is written in the repo, so a page edited by hand and a page saved by the editor look the same.

  Workshop posts   updates/<slug>.html and projects/<slug>.html, plus their card in index.html
                   and, for posts that belong to an in-progress project, in that project's page.
  Recruiter posts  the <article class="post"> blocks inside index.html.
"""
import html
import os
import textwrap
import re
from html.parser import HTMLParser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
INDEX = os.path.join(ROOT, "index.html")
FOLDERS = {"updates": "Recent updates", "projects": "Past projects"}
MONTHS = "January February March April May June July August September October November December".split()
TEXT_TAGS = {"p", "ul", "ol", "blockquote"}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def slugify(title):
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60] or "post"


def long_date(date):
    y, m, d = date.split("-")
    return f"{MONTHS[int(m) - 1]} {int(d)}, {y}"


def short_date(date):
    return long_date(date)[:3] + long_date(date)[long_date(date).index(" "):]


# ---------- post bodies: boxes around text and tables ----------

class _TopLevel(HTMLParser):
    """Splits a body into its top-level elements (with any text between them), keeping their source."""

    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.text, self.parts, self.depth, self.start, self.tag = text, [], 0, 0, None
        self.lines = [0]
        for line in text.splitlines(keepends=True):
            self.lines.append(self.lines[-1] + len(line))
        self.feed(text)
        self.close()
        self.parts.append((None, text[self.start:]))

    def _at(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col

    def handle_starttag(self, tag, attrs):
        if tag in ("img", "br", "hr", "source", "input"):
            if self.depth == 0:
                self._flush()
                end = self._at() + len(self.get_starttag_text())
                self.parts.append((tag, self.text[self._at():end]))
                self.start = end
            return
        if self.depth == 0:
            self._flush()
            self.tag = (tag, dict(attrs).get("class", ""))
        self.depth += 1

    def handle_endtag(self, tag):
        if tag in ("img", "br", "hr", "source", "input"):
            return
        self.depth -= 1
        if self.depth == 0:
            end = self.text.index(">", self._at()) + 1
            self.parts.append((self.tag, self.text[self.start:end]))
            self.start = end

    def _flush(self):
        here = self._at()
        if here > self.start:
            self.parts.append((None, self.text[self.start:here]))
        self.start = here


def unbox(body):
    """The body as a flat list of blocks, without the boxes, for editing."""
    return re.sub(r'<div class="(text|table)-box">\s*(.*?)\s*</div><!--/box-->', r"\2", body, flags=re.S).strip()


def box(body):
    """Runs of paragraphs and lists go in one thin-bordered box each; every table gets its own
    box (which scrolls sideways on a phone). Headings, pictures and videos stay outside."""
    body = unbox(body)
    out, run = [], []

    def close_run():
        if run:
            out.append('<div class="text-box">\n' + "\n".join(run) + "\n</div><!--/box-->")
            run.clear()

    for tag, source in _TopLevel(body).parts:
        source = source.strip()
        if not source:
            continue
        name = tag[0] if tag else None
        if name in TEXT_TAGS or (tag is None and source):
            run.append(source if name else f"<p>{source}</p>")
        elif name == "table":
            close_run()
            out.append(f'<div class="table-box">\n{source}\n</div><!--/box-->')
        else:
            close_run()
            out.append(source)
    close_run()
    return "\n".join(out)


def clean(body):
    """What the browser's editor leaves behind, tidied: no inline styles or spans, no empty paragraphs."""
    body = re.sub(r'\s(style|dir|data-[\w-]+)="[^"]*"', "", body)   # classes stay: galleries and link rows use them
    body = re.sub(r"</?(span|font)[^>]*>", "", body)
    body = re.sub(r"<div>(.*?)</div>", r"<p>\1</p>", body, flags=re.S)
    body = re.sub(r"<p>(\s|&nbsp;|<br>)*</p>", "", body)
    body = re.sub(r"<figure>\s*(<figure>.*?</figure>)\s*</figure>", r"\1", body, flags=re.S)   # WordPress nests them
    body = re.sub(r"<figure>\s*(<table>.*?</table>)\s*(?:<figcaption>.*?</figcaption>\s*)?</figure>", r"\1", body, flags=re.S)
    body = re.sub(r"<b>(.*?)</b>", r"<strong>\1</strong>", body, flags=re.S)
    body = re.sub(r"<i>(.*?)</i>", r"<em>\1</em>", body, flags=re.S)
    return body.strip()


# Pictures are written relative to the page; the editor shows them from the site root.
def to_editor(body, up):
    return re.sub(r'(src|href)="' + re.escape(up) + r'assets/', r'\1="/assets/', body)


def from_editor(body, up):
    return re.sub(r'(src|href)="/assets/', rf'\1="{up}assets/', body)


# ---------- Workshop posts ----------

PAGE = """<!doctype html>
<!-- Edited with tools/editor. -->
<html lang="en" data-theme="amazed">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} · Coen Hao</title>
  <meta name="color-scheme" content="dark">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap">

  <link rel="stylesheet" href="../css/tokens.css">
  <link rel="stylesheet" href="../css/base.css">
  <link rel="stylesheet" href="../css/amazed.css">
</head>
<body>
  <div class="subpage">
    <header>
      <a class="back" href="../index.html#amazed" aria-label="Back to workshop"><span class="back__arrow" aria-hidden="true">&larr;</span>Back</a>
      <h1 class="amazed__title">{title}</h1>
      <p class="subpage__meta">
        {meta}
      </p>
    </header>

    <main class="prose">
{body}
    </main>
  </div>
</body>
</html>
"""


def projects():
    """In-progress projects: the feature cards in index.html, slug -> name."""
    found = re.findall(r'<a class="feature" href="projects/([\w-]+)\.html">.*?<h3 class="feature__name">(.*?)</h3>',
                       read(INDEX), flags=re.S)
    return {slug: html.unescape(name) for slug, name in found}


def cards():
    """Every Workshop card in index.html, newest first per shelf."""
    out = []
    for folder, slug, date, title, line in re.findall(
            r'<a class="tile" href="(updates|projects)/([\w-]+)\.html">\s*<span class="tile__meta">(.*?)</span>\s*'
            r'<h3 class="tile__name">(.*?)</h3>\s*<p class="tile__desc">(.*?)</p>', read(INDEX), flags=re.S):
        out.append({"folder": folder, "slug": slug, "title": html.unescape(title), "line": html.unescape(line),
                    "shown_date": date})
    return out


def load_post(folder, slug):
    page = read(os.path.join(ROOT, folder, f"{slug}.html"))
    title = html.unescape(re.search(r'<h1 class="amazed__title">(.*?)</h1>', page, flags=re.S).group(1))
    date = re.search(r'<time datetime="([\d-]+)"', page)
    project = re.search(r'href="\.\./projects/([\w-]+)\.html"', page)
    body = re.search(r'<main class="prose">\s*(.*?)\s*</main>', page, flags=re.S).group(1)
    card = next((c for c in cards() if c["folder"] == folder and c["slug"] == slug), {})
    return {"folder": folder, "slug": slug, "title": title, "date": date.group(1) if date else "",
            "project": project.group(1) if project else "", "line": card.get("line", ""),
            "body": to_editor(unbox(dedent(body)), "../")}


def dedent(body):
    """Removes the indentation the page source adds, whatever its depth (the first line has none:
    it comes straight after the opening tag)."""
    lines = body.splitlines()
    return "\n".join([lines[0].strip()] + textwrap.dedent("\n".join(lines[1:])).splitlines()).strip() if lines else ""


def tile(folder, slug, date, title, line, up=""):
    return (f'<a class="tile" href="{up}{folder}/{slug}.html">\n'
            f'              <span class="tile__meta">{short_date(date)}</span>\n'
            f'              <h3 class="tile__name">{html.escape(title, quote=False)}</h3>\n'
            f'              <p class="tile__desc">{html.escape(line, quote=False)}</p>\n'
            f'            </a>')


def _put_tile(text, shelf_id, folder, slug, new_tile):
    """Replaces this post's tile, or adds it at the top of the shelf headed `shelf_id`."""
    pattern = rf'<a class="tile" href="(\.\./)?{folder}/{slug}\.html">.*?</a>'
    if re.search(pattern, text, flags=re.S):
        return re.sub(pattern, lambda m: new_tile, text, count=1, flags=re.S)
    head = text.find(f'id="{shelf_id}"')
    if head < 0:
        return text
    at = text.index('<div class="tiles', head)
    at = text.index(">", at) + 1
    return text[:at] + "\n            " + new_tile + text[at:]


def _sort_shelves(text):
    """Every shelf of tiles newest first, laid out the same way, so saving an old post never reorders anything."""
    def when(tile_html):
        shown = re.search(r'<span class="tile__meta">(\w+) (\d+), (\d{4})</span>', tile_html)
        if not shown:
            return (0, 0, 0)
        return (int(shown[3]), [m[:3] for m in MONTHS].index(shown[1][:3]) + 1, int(shown[2]))

    def shelf(m):
        tiles = re.findall(r'<a class="tile".*?</a>', m.group(2), flags=re.S)
        if not tiles:
            return m.group(0)
        tiles = [re.sub(r"\n\s*", "\n              ", t).replace("\n              </a>", "\n            </a>") for t in tiles]
        tiles.sort(key=when, reverse=True)       # stable: same-day posts keep their order
        return m.group(1) + "\n            " + "\n            ".join(tiles) + "\n          </div>"
    return re.sub(r'(<div class="tiles[^"]*">)(\s*<a class="tile".*?</a>)\s*</div>', shelf, text, flags=re.S)


def _drop_tile(text, folder, slug):
    return re.sub(rf'\s*<a class="tile" href="(\.\./)?{folder}/{slug}\.html">.*?</a>', "", text, flags=re.S)


def save_post(data):
    folder, title = data["folder"], data["title"].strip()
    if folder not in FOLDERS or not title or not re.fullmatch(r"\d{4}-\d\d-\d\d", data.get("date", "")):
        raise ValueError("A post needs a shelf, a title and a date.")
    slug = data.get("slug") or slugify(title)
    if not data.get("slug") and os.path.exists(os.path.join(ROOT, folder, f"{slug}.html")):
        raise ValueError(f'There is already a post at {folder}/{slug}.html; give this one another title.')
    project = data.get("project") or ""
    meta = f'<time datetime="{data["date"]}">{long_date(data["date"])}</time>'
    if project:
        meta += f' &middot;\n        <a href="../projects/{project}.html">{html.escape(projects().get(project, project))}</a>'
    body = box(clean(from_editor(data.get("body", ""), "../")))
    body = "      " + body.replace("\n", "\n      ")
    write(os.path.join(ROOT, folder, f"{slug}.html"),
          PAGE.format(title=html.escape(title, quote=False), meta=meta, body=body))

    line = data.get("line", "").strip() or title
    index = _put_tile(read(INDEX), {"updates": "recent-updates", "projects": "past-projects"}[folder], folder, slug,
                      tile(folder, slug, data["date"], title, line))
    write(INDEX, _sort_shelves(index))
    # The project pages list their own updates and posts.
    for other in projects():
        path = os.path.join(ROOT, "projects", f"{other}.html")
        if not os.path.exists(path):
            continue
        text = read(path)
        if other == project:   # replaced where it stands, so same-day posts keep their order
            text = _put_tile(text, folder if folder == "updates" else "posts", folder, slug,
                             tile(folder, slug, data["date"], title, line, "../"))
        else:
            text = _drop_tile(text, folder, slug)
        write(path, _sort_shelves(text))
    return slug


def delete_post(folder, slug):
    path = os.path.join(ROOT, folder, f"{slug}.html")
    if folder not in FOLDERS or not os.path.exists(path):
        raise ValueError("No such post.")
    os.remove(path)
    write(INDEX, _drop_tile(read(INDEX), folder, slug))
    for other in projects():
        p = os.path.join(ROOT, "projects", f"{other}.html")
        if os.path.exists(p):
            write(p, _drop_tile(read(p), folder, slug))


# ---------- Recruiter posts (articles in index.html) ----------

ARTICLE = re.compile(r'(<article class="post" id="([\w-]+)">\s*<h3 class="post__title">)(.*?)(</h3>\s*'
                     r'(?:<p class="post__date">(.*?)</p>\s*)?<div class="post__body">)(.*?)(</div>\s*</article>)', re.S)


def articles():
    text = read(INDEX)
    out = []
    for m in ARTICLE.finditer(text):
        section = re.findall(r'<h2 class="collection__title" id="[\w-]+">(.*?)</h2>', text[:m.start()])
        out.append({"id": m.group(2), "title": html.unescape(re.sub(r"<[^>]+>", "", m.group(3))),
                    "section": html.unescape(section[-1]) if section else ""})
    return out


def load_article(post_id):
    for m in ARTICLE.finditer(read(INDEX)):
        if m.group(2) == post_id:
            return {"id": post_id, "title": html.unescape(m.group(3)), "subtitle": html.unescape(m.group(5) or ""),
                    "body": to_editor(dedent(m.group(6)).strip(), "")}
    raise ValueError("No such post.")


def save_article(data):
    text = read(INDEX)
    for m in ARTICLE.finditer(text):
        if m.group(2) != data["id"]:
            continue
        sub = data.get("subtitle", "").strip()
        head = m.group(1) + html.escape(data["title"].strip(), quote=False) + "</h3>\n          "
        if sub:
            head += f'<p class="post__date">{html.escape(sub, quote=False)}</p>\n          '
        body = clean(from_editor(data.get("body", ""), ""))
        body = "\n            " + body.replace("\n", "\n            ") + "\n          "
        write(INDEX, text[:m.start()] + head + '<div class="post__body">' + body + m.group(7) + text[m.end():])
        return
    raise ValueError("No such post.")
