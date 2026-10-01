# Playable showcase gallery

The root `index.html` and `gallery/style.css` form a semantic HTML/CSS gallery with no runtime
JavaScript, framework, remote font, or live game canvas. Craftlands is featured; five games form
the main two-column grid; Particle Atlas and Core Run sit in a smaller Feature Lab. On phones,
both grids become one column. Whole-card anchors work with keyboard, pointer, and touch; the
skip link bypasses navigation. Motion is limited to a small image/arrow hover transform and is
disabled with `prefers-reduced-motion`.

The presentation takes media-first cards, minimal copy, quiet navigation, and generous spacing
as design principles from the [Framer Gallery](https://www.framer.com/community/gallery/).
Layout, system typography, colors, copy, and imagery are authored for three-game-kit; no Framer
components, branding, or media are included.

## Cover provenance

All sixteen checked-in `covers/*.webp` files are captures of this repository's own rendered demos,
using their public `?test=1` QA handles. No external imagery or generated game art is used.
The initial scenes were captured from upstream checkpoint
`854b0d0e0dcb4378f6705f2ef1eb3a0ecc99886b` with Playwright 1.62.1's bundled Chromium.
Scenes, models, textures, and effects retain the provenance documented in the corresponding
showcase/example README and asset manifests. Only the capture context hides HUD overlays;
the playable demos are unchanged.

| Cover | Source | Authored capture state |
| --- | --- | --- |
| Craftlands | `showcases/craftlands` | Seed 8675309, distance 5, daytime spawn overlooking a pond |
| Relic Frontier | `showcases/relic-frontier` | Loaded ranger model, guardian encounter, onboarding dismissed |
| Afterglow | `showcases/afterglow` | Start scenario, throttle and boost, 1.2 seconds advanced |
| Gravetide | `showcases/gravetide` | Seed 4242, swarm scenario, 0.2 seconds advanced |
| Deepfield | `showcases/deepfield` | Seed 1337, daytime spawn facing the wooded hills |
| Chroma Strike | `showcases/relic-frontier/chroma-strike` | Started arena, 2 seconds advanced |
| Particle Atlas | `examples/particles` | Singularity effect, 90 presentation frames at 32 ms, full-canvas preview |
| Core Run | `showcases/core-run` | Started arena, 3.5 seconds advanced |

Exact camera angles, seed parameters, and stepping recipes live in
[`scripts/lib/gallery-covers.mjs`](../scripts/lib/gallery-covers.mjs). Captures use fresh browser
contexts with empty storage, a 1280×720 viewport, and device scale factor 1. Exported WebP files
have a consistent 16:9 ratio at 640×360 and 1280×720, with quality 0.82. Browser/GPU differences
may change pixels; these assets are authored presentation, not golden gameplay test assertions.

The total responsive image inventory is below 1 MiB. The automated budget is 80 KiB per small
image and 256 KiB per large image. The featured cover has high fetch priority; all other covers
are lazy-loaded. Explicit dimensions and CSS aspect ratios reserve layout space. Relative
asset and playable links work at the Vite root and the GitHub Pages repository base path.

## Regenerate covers

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run capture:gallery
```

The command starts a local Vite server on port 4177 and closes it and Chromium on completion
or failure. To regenerate just one cover, pass its ID, e.g. `pnpm run capture:gallery relic-frontier`.
If a dev server is already running, explicitly use it with
`GALLERY_CAPTURE_ORIGIN=http://127.0.0.1:4177 pnpm run capture:gallery`.
The script waits for readiness (including Relic Frontier's glTF model), runs the recipe, hides
HUD chrome, captures the visible canvas through Playwright, and encodes both WebP sizes in
Chromium. It rejects empty frames and runtime errors. Review the resulting scenes before
committing the files, and keep the alt text and this provenance table accurate.

## Validate

```sh
pnpm run test:gallery-assets  # required cards, source entries, recipes, covers, byte budgets
pnpm run verify:gallery      # assets plus browser checks on dev and built Pages servers
pnpm run build:pages
pnpm run preview:pages       # open http://127.0.0.1:4175/three-game-kit/
```

The browser suite checks all eight destinations and sixteen images against both server modes,
including actual decoded dimensions, local-only requests, desktop/tablet/phone layouts,
reserved space while images load, keyboard focus/navigation, touch activation, and reduced
motion. Desktop and mobile screenshots are saved under `test-results` for visual review.
CI runs the complete gallery suite. The Pages workflow checks the cover inventory before
building. No captures are generated during deployment, and no additional dependencies are needed.
The test servers use ports 4186 (dev) and 4185 (Pages); override with `GALLERY_DEV_PORT` and
`GALLERY_PAGES_PORT` if needed. Their ports are separate from the normal Pages preview command.
