# Third-party credits for build/viz

## God's Eye View (MIT)
`coverage.html` adapts small pieces of God's Eye View, https://github.com/bilawalsidhu/gods-eye-view
(read-only clone at commit b210ab0; never installed or run):

- ID-box placement, leader-line end points and card chrome (plate, border, left accent bar, anchor dot):
  `src/overlays/worldOverlayDraw.js` (`writePlacement`, `placementVariants`, `drawCardChrome`, `drawAnchorDot`)
- colour and font tokens: `src/ui/styles/foundation.css`, `src/overlays/worldOverlayTokens.js`
- URL-hash view state with `history.replaceState`: `src/sharelink.js`
- month scrubber with previous / next / play: `src/ui/railTimeline.js`
- corner-bracket panel framing: the idea from `src/hud.js` (redrawn in CSS)

Not used: shaders and sensor filters, classification banners, aircraft / vessel / CCTV / licence-plate
layers, 3D models, and any bundled data (none of it is MIT).

The full MIT notice is in the header comment of `coverage.html`:

    MIT License
    Copyright (c) 2026 Bilawal Sidhu

## Natural Earth (public domain)
`world_110m.js` holds Natural Earth 1:110m admin-0 country boundaries (public domain,
https://www.naturalearthdata.com), taken from the `world-atlas@2.0.2` package
(`countries-110m.json`, ISC licence, Mike Bostock) and pre-projected to Equal Earth by
`agents/b19/gen_data.py`. Antarctica is dropped. Hong Kong and Malta are too small for 1:110m and are
drawn as dots.

## Fonts
JetBrains Mono (OFL) and Inter (OFL) from Google Fonts when online; the page falls back to system
fonts offline.
