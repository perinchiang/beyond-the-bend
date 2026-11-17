# Beyond the Bend — "Painted Diorama" visual prototype

A small, drivable miniature world built to answer one question: can procedural geometry,
script-generated 3D models and custom shaders produce visuals that read as a polished indie
game rather than a tech demo? This is a **visual and technical prototype**, not a game.

Stack: Three.js (r187) · TypeScript · WebGL 2 · Vite · Blender Python → GLB.

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5183/
npm run build        # type-check + production bundle
npm run car          # regenerate public/models/car.glb with Blender (needs `blender` on PATH)
```

## Controls

| | |
|---|---|
| `W A S D` / arrows | drive (steering is always relative to the car) |
| `Space` | brake |
| `C` | switch **Driving camera** ⇄ **Free camera** |
| `V` | cycle driving view: **High → Normal → Close** (Driving camera only) |
| drag / `Q E` · `R F` · wheel / `Z X` · shift-drag | orbit · tilt · zoom · pan (**Free camera only**) |
| `T` | miniature lens on/off |
| `H` | hide the legend |

URL options: `?cam=free`, `?preset=0|1|2`, `?s=<metres along the road>`, `?q=low|high`,
`?tilt=0`, `?stats=1`, `?hud=0`.

### Cameras

Both modes use the same orthographic "miniature" lens.

- **Driving (default)** — locked behind the car; the road runs up the screen and the car sits a
  little below centre. No orbit, tilt, zoom or pan: the rig ignores those inputs. Yaw follows the
  car's heading through a critically damped filter, so the view glides through corners and only
  tightens if the tail starts to swing away. Presets:

  | preset | tilt | view height | car position | yaw time constant |
  |---|---|---|---|---|
  | High | 58° | 66 m | 13 % below centre | 0.40 s |
  | Normal (default) | 45° | 44 m | 17 % below centre | 0.32 s |
  | Close | 28° | 24 m | 20 % below centre | 0.26 s |

- **Free / photo** — orbit, tilt, zoom and pan. It tracks the car's position but not its heading.
  Entering it changes nothing on screen (the driving pose is handed over as-is); leaving it eases
  back behind the car.

The camera only reads the car's pose. `tools/camera-test.mjs` replays a fixed input script with and
without constant mode/preset switching and checks the vehicle ends in a bit-identical state.

## How the picture is made

| Layer | Source |
|---|---|
| Terrain shape | Procedural height field (fBm + one authored hill and dip), 320×320 grid. The road corridor is cut in with a distance field so verges are flat and embankments ease into the hills. |
| Road | Hand-authored closed Catmull-Rom spline (25 control points, 1.3 km). A ribbon mesh carries exact lateral coordinates, so edge lines and dashes are analytic and stay crisp. |
| Terrain paint | Custom GLSL injected into Three's Lambert material: broad gouache washes, brush-dab edges, short grass ticks, dry-brush grain, painted form shading from terrain curvature, earth shoulders, drifting cloud shadows, and a stippled dissolve into paper at the world edge. |
| Textures | Two small tileable textures baked at start-up (16-bit noise with a hand-built mip chain; Canvas2D brush strokes). No image files, no AI imagery. All sampled in world space. |
| Vegetation, rocks | Procedural generators (`src/world/flora.ts`): lobed crowns of leaf-shaped dabs over a dark core with volume normals; tiered conifers; birches; bushes; boulders; grass tufts; flowers. Placed with authored groves + noise, instanced in 100 m chunks. |
| Roadside | Delineator posts, corner chevrons (placed from spline curvature), post-and-rail fences — one merged mesh. |
| Car | `tools/blender/build_car.py`: a lofted hatchback shell from hand-tuned cross-sections, boolean wheel wells, arch flares, inset glazing, lamps, bumpers, spoiler, lamp pod, separate spoked wheels (~6k triangles). Colours are assigned in code by material name. |
| Light | One warm directional sun with a texel-snapped PCF shadow map, cool hemisphere fill. Foliage is lit by its volume normals and does not receive shadow-map shadows. |
| Lens | One post chain: half-resolution tilt-shift blur, soft highlight roll-off, mild grade and vignette. |

## Checks

```bash
npm run shots                 # capture review screenshots into shots/ (needs dev server + Chrome)
node tools/camera-test.mjs    # camera modes, presets, transitions, vehicle independence
node tools/stability.mjs      # pan the camera a whole number of pixels and compare re-aligned frames
```

## Known limitations

- Tested on one machine only (Apple M2, Chrome, macOS). **Not tested on any phone or tablet**;
  `?q=low` exists and renders, but mobile performance and touch controls are unverified / absent.
- Driving is a deliberately simple arcade model with no collisions; trees and props are not solid.
- The Close driving view is still orthographic, so it is tighter and lower rather than a true
  perspective chase camera; low angles can let roadside trees cover the car in corners.
- Trees are not shadowed by other trees, there is no level-of-detail for foliage, and the leaf dabs
  look blocky in extreme close-up.
- Rocks are the weakest asset: plain faceted boulders.
- One small world (400 m square), one biome, one car, no audio.
