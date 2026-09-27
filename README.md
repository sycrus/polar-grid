# polar-grid

Letters carved onto pulsing spheres — a p5.js (WEBGL) sketch. Each typed
letter spawns a sphere whose surface is a polar grid of cells: the glyph is
rasterised to an offscreen buffer, sampled per cell, and the lit cells are
drawn as quads on the sphere, so the letter swells out from the north pole,
spans the globe, and contracts again. Spheres can be moved, rotated and
stretched into ellipsoids to compose scenes.

## Run it

Open `index.html` in a browser (or serve the folder with any static server).
Vendored libraries: [p5.js](https://p5js.org), p5.easycam, CCapture.

## Controls

Composition:

| input | action |
| --- | --- |
| type letter / number | spawn a sphere |
| click / drag / shift+drag | select / move / rotate a sphere |
| arrows · `[` `]` | stretch x/y · depth |
| backspace | delete selection (or last sphere) |
| F · R | freeze the pulse · reset shape |
| G | toggle the wireframe grid on all spheres |

Scene I/O:

| input | action |
| --- | --- |
| S | save the scene as JSON |
| L | load a saved JSON |
| ` | record 720 frames as PNGs (CCapture) |

Camera: drag empty space to orbit, scroll to zoom, right-click to save an
image. The bar at the bottom mirrors these as clickable buttons and stays out
of recorded frames.

## Typeface

Set in [Aladin](https://fonts.google.com/specimen/Aladin) by Santiago Orozco
(SIL Open Font License), included as `Aladin-Regular.ttf`.
