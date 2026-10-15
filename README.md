# Website

Static site, no build step. Open `index.html` through any local server
(`python3 -m http.server`) and it runs; GitHub Pages serves it as-is.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Three views in one page: landing, recruiter (`#recruiter`), amazed (`#amazed`). |
| `projects/example.html` | Template for a project page. Copy it once per project. |
| `updates/example.html` | Template for an update page. Copy it once per update. |
| `css/tokens.css` | Every colour, size and timing. Themes live here. |
| `css/base.css` | Shared rules and the view-switching states. |
| `css/landing.css`, `css/recruiter.css`, `css/amazed.css` | One file per view. |
| `js/views.js` | Picks the view from the URL hash and runs the transition. |
| `js/landing.js` | Hover/focus preview on the landing sheets; warms what the next step needs. |
| `js/scene.js` | Draws the landing on a pixel canvas: sheets, shadows, particles, flag wave. |
| `js/pixel.js` | Pixel-art helpers: the sheet sprite, a 3 × 5 bitmap font, dithering, particles. |
| `js/wipe.js` | The amazed preview's darkening: a dither front rising from the bottom, sinking back on leave. |
| `js/airplane.js` | The landing → Workshop paper-plane transition (loaded on demand). |
| `js/recruiter.js` | Builds the sidebar post list and the scroll marker. |
| `tools/spring.py` | Generates the `--spring` and `--bubble` easing curves in `tokens.css` (`hold` gives a frame-held staircase). |
| `tools/editor/` | The website editor: `server.py` (local server, only on this Mac), `editor.html` (the page), `sitefiles.py` (reads and writes posts), `launcher.applescript` (source of “Website Editor.app”). |
| `tools/pixelate.py` | Turns a photo into an 8-bit sprite (crop, downsample, dither). |
| `assets/landing/` | The two landing pictures (recruiter 192 × 160, amazed 216 × 180), 6 : 5, 48 colours. |
| `assets/resume/` | The two résumé PDFs linked from the Résumé section (vehicle dynamics, testing & validation). |
| `assets/projects/` | Photos for the Portfolio posts, named after the post (`turbo-1.jpg`, `efi-3.jpg`, …), at most 1000 px. |
| `assets/team/` | The Team Opposite Lock gallery. |
| `design-system.html` | Reference sheet for the recruiter theme. |

The landing is drawn on one canvas by `js/scene.js`, at a fine pixel of 2 CSS
px scaled up without smoothing. Sheets are 22 × 31 big pixels (K × K fine
pixels each, about 20 CSS px on a laptop), built cell by cell in `js/pixel.js`
and coloured by the `--sheet-*` tokens; photos keep the fine pixel. The links in `index.html` lay the sheets out and carry
their text (`data-label`, `data-photo`); without JavaScript they show as
plain boxes.

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
- **New landing picture:** `python3 tools/pixelate.py photo.jpg assets/landing/recruiter.png --box LEFT TOP HEIGHT [--mirror]`.

## Loading

Only what the first screen needs loads up front: the page, its CSS, three
small scripts, the two sprites (about 10 KB together) and the two pixel
fonts. Everything else waits for a sign of interest:

- `js/airplane.js` is fetched when someone hovers or focuses the amazed sheet.
- EB Garamond's font files are fetched when someone hovers the recruiter sheet.
- Project and update pages are prefetched after about 200 ms of hovering their
  card (speculation rules; browsers without them just load on click).
- Hidden views are `display: none`, so they cost no layout or painting.
- The canvas only runs while something moves, and hides when the landing does.

Give pictures inside the Workshop `loading="lazy"` so they load only when
scrolled near.

## Editing without code

Open **Website Editor.app** (in `~/Desktop/Code`; the first time, macOS asks to let it open files in the
Desktop folder). It lists every Workshop post and recruiter post; pick one, edit it like a document,
drag pictures, GIFs or short clips in, and **Save**. Saved changes show in the preview straight away but
are only on this Mac until **Publish**, which commits and pushes to GitHub (the live site follows in a
minute or two) and refreshes `../Website Functions`. **Discard changes** throws away everything since the
last publish.
