# Website

Static site, no build step. Open `index.html` through any local server
(`python3 -m http.server`) and it runs; GitHub Pages serves it as-is.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Three views in one page: landing, portfolio (`#recruiter`), workshop (`#amazed`). |
| `projects/example.html` | Template for a project page. Copy it once per project. |
| `updates/example.html` | Template for an update page. Copy it once per update. |
| `css/tokens.css` | Colours, type sizes and spacing. |
| `css/base.css` | Shared rules and the view-switching states. |
| `css/landing.css`, `css/recruiter.css`, `css/amazed.css` | One file per view (`amazed.css` also styles the project and update pages). |
| `js/views.js` | Picks the view from the URL hash and fades between them. |
| `js/recruiter.js` | Builds the sidebar post list and the scroll marker. |
| `tools/editor/` | The website editor: `server.py` (local server, only on this Mac), `editor.html` (the page), `sitefiles.py` (reads and writes posts), `launcher.applescript` (source of “Website Editor.app”). |
| `assets/resume/` | The two résumé PDFs linked from the Résumé section (vehicle dynamics, testing & validation). |
| `assets/projects/` | Photos for the Portfolio posts, named after the post (`turbo-1.jpg`, `efi-3.jpg`, …), at most 1000 px. |
| `assets/team/` | The Team Opposite Lock gallery. |
| `design-system.html` | Reference sheet for the recruiter theme. |

## Adding content

- **Recruiter post:** add an `<article class="post">` in the right section of
  `index.html` (template in the comment above the Portfolio section). The
  sidebar link appears by itself.
- **Résumé PDF:** export from Word over the file in `assets/resume/` (same name, so the links keep working).
- **Post photos:** save to `assets/projects/` at most 1000 px wide and add an
  `<a><img loading="lazy"></a>` to the post's `.gallery`.
- **Project or update:** copy the template, fill it in, and point a card in
  the Amazed view at it.
- **Picture on an in-progress card:** put an `<img>` inside `.feature__media`.

## Loading

Hidden views are `display: none`. Project and update pages are prefetched after
about 200 ms of hovering their card. Give pictures `loading="lazy"`.

## Editing without code

Open **Website Editor.app** (in `~/Desktop/Code`; the first time, macOS asks to let it open files in the
Desktop folder). It lists every Workshop post and recruiter post; pick one, edit it like a document,
drag pictures, GIFs or short clips in, and **Save**. Saved changes show in the preview straight away but
are only on this Mac until **Publish**, which commits and pushes to GitHub (the live site follows in a
minute or two) and refreshes `../Website Functions`. **Discard changes** throws away everything since the
last publish.
