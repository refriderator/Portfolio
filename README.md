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
| `js/landing.js` | Hover/focus preview on the landing boxes. |
| `js/recruiter.js` | Builds the sidebar post list and the scroll marker. |
| `tools/spring.py` | Generates the `--spring` and `--bubble` easing curves in `tokens.css`. |
| `tools/pixelate.py` | Turns a photo into an 8-bit sprite (crop, downsample, dither). |
| `assets/landing/` | The two landing sprites, 96 × 112 px each. |
| `design-system.html` | Reference sheet for the recruiter theme. |

## Adding content

- **Recruiter post:** add an `<article class="post">` in the right section of
  `index.html` (template in the comment above the Portfolio section). The
  sidebar link appears by itself.
- **Résumé PDF:** save it as `assets/resume.pdf`.
- **Project or update:** copy the template, fill it in, and point a card in
  the Amazed view at it.
- **Picture on an in-progress card:** put an `<img>` inside `.feature__media`.
- **New landing picture:** `python3 tools/pixelate.py photo.jpg assets/landing/recruiter.png --box LEFT TOP HEIGHT [--mirror]`.
