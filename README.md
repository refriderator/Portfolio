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
| `js/airplane.js` | The landing → Workshop paper-plane transition (loaded on demand). |
| `js/recruiter.js` | Builds the sidebar post list and the scroll marker. |
| `tools/spring.py` | Generates the `--spring`, `--bubble` and `--bubble-held` easing curves in `tokens.css` (`hold` for the 12 fps staircase). |
| `tools/pixelate.py` | Turns a photo into an 8-bit sprite (crop, downsample, dither). |
| `assets/landing/` | The two landing sprites (recruiter 96 × 112, amazed 80 × 113). |
| `design-system.html` | Reference sheet for the recruiter theme. |

The landing sheets are a 28 × 40 pixel-art sprite, the `#sheet` symbol at
the top of `index.html`, coloured by the `--sheet-*` tokens. One sheet pixel
(`--pp`) is the sheet's width / 28.

## Adding content

- **Recruiter post:** add an `<article class="post">` in the right section of
  `index.html` (template in the comment above the Portfolio section). The
  sidebar link appears by itself.
- **Résumé PDF:** save it as `assets/resume.pdf`.
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
- The folding plane is removed from the page as soon as it leaves the screen.

Give pictures inside the Workshop `loading="lazy"` so they load only when
scrolled near.
