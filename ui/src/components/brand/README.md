# MD CAD AI STUDIO — brand in the app

Name: **MD CAD AI STUDIO** · Credit line (exact, never translated or edited): **Xây dựng và phát triển bởi Minh Dũng**

## Assets (`ui/public/assets/branding/`)
All are made from the approved logo (`md-logo-source.png`, transparent PNG supplied by the owner) by
`ui/tools/make-branding.py` — crops and a dark-background variant only; the artwork is not redrawn.

| File | Use |
|---|---|
| `md-logo.png` / `md-logo-dark.png` | full lockup on light / dark backgrounds (dark: the graphite lettering lifted to silver so it reads) |
| `md-monogram.png` / `-dark.png` | MD monogram with its construction lines (sidebar, loader, intro, installer hero) |
| `md-wordmark.png` / `-dark.png` | "MD CAD AI STUDIO" with its underline (intro, installer) |
| `md-wordmark-text.png` / `-dark.png` | the letters only, for small sizes (sidebar) |
| `md-app-icon-1024.png` | app icon tile (graphite gradient, blueprint grid, teal glow, monogram) → `native/app/resources/branding/AppIcon.icns` (macOS) and `app.ico` (Windows), `md-favicon.png` |

No app-icon or intro artwork file was supplied besides the logo: the icon is composed from the logo's monogram,
and the intro / installer visuals are built in code (below).

## Components (`ui/src/components/brand/`)
- `BrandLogo` — full / monogram / wordmark / horizontal / stacked lockups, light or dark.
- `IntroScreen` — the opening animation; `SplashScreen` — runs it at launch over the app while the real start-up
  work is done (fonts, stored drawings, desktop host, local AI status), then fades into the Dashboard. Skip:
  click, Esc, Enter. Not shown for automated QA (`?splash=0`, WebDriver, `THCAD_SCRIPT`, `THCAD_SPLASH=0`);
  `?splash=1` forces it. With animations off (Settings) or reduced motion: a still frame.
- `InstallerWelcomeScreen` — installer welcome (hero left, setup information right); its hero is exported for
  the real installers by `ui/tools/make-installer-art.mjs` (Inno Setup wizard images per DPI, DMG background).
- `BrandLoader` + `brandLoading.run(text, work)` — loading state for start-up, model loading (Settings),
  opening drawings (DWG conversion).
- `AppIconPreview` — the icon at Dock / Finder sizes. Preview page: `#/brand`.

## What is animated how
| Element | Technique |
|---|---|
| background light, blueprint grid drift, light streak | CSS gradients + keyframes |
| particles | `<canvas>`, ~46 dots |
| construction lines and nodes drawing | SVG `stroke-dashoffset` (code) |
| monogram assemble (two halves slide in, de-blur) | CSS clip-path + transform + filter **over the logo image** |
| light sweep across the monogram | CSS gradient masked by the monogram image (**overlay on the image**) |
| wordmark reveal + scan line | CSS clip-path on the wordmark image + a code-drawn scan line (**overlay**) |
| credit, progress line, status | CSS (text is live text, Roboto) |
| installer: hero fade-in, glow pulse, parallax, tech trace | CSS + SVG, parallax by pointer |
