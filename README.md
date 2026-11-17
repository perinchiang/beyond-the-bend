# Beyond the Bend — "Painted Diorama" visual prototype

A small, drivable miniature world built to answer one question: can procedural geometry,
script-generated 3D models and custom shaders produce visuals that read as a polished indie
game rather than a tech demo? This is a **visual and technical prototype**, not a game.

Stack: Three.js (r187) · TypeScript · WebGL 2 · Vite · Blender Python → GLB.

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5183/beyond-the-bend/
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
  little below centre. No orbit, tilt, zoom or pan: the rig ignores those inputs. Horizontal camera
  follow is immediate; a 12° heading dead zone lets the car move through small corrections before
  the camera turns, and the larger turn is rate/acceleration limited. Presets:

  | preset | tilt | view height | car position | yaw time constant |
  |---|---|---|---|---|
  | High | 58° | 66 m | 13 % below centre | 0.40 s |
  | Normal (default) | 45° | 44 m | 17 % below centre | 0.32 s |
  | Close | 28° | 24 m | 20 % below centre | 0.26 s |

- **Free / photo** — orbit, tilt, zoom and pan. It follows the car's horizontal position immediately,
  smooths only height over grade changes, and does not track its heading.
  Entering it changes nothing on screen (the driving pose is handed over as-is); leaving it eases
  back behind the car.

The camera only reads the car's pose. `tools/camera-test.mjs` replays a fixed input script with and
without constant mode/preset switching and checks the vehicle ends in a bit-identical state.

Camera behavior was reviewed against gameplay footage from [art of rally](https://store.steampowered.com/app/550320/art_of_rally/) and [Absolute Drift](https://store.steampowered.com/app/320140/Absolute_Drift/). Both keep the route readable and the car legible despite using different camera styles. This game retains its orthographic diorama and three driving presets, while using stable horizontal tracking, restrained world rotation and predictable road visibility as reference principles. Handling and input mapping remain unchanged.

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
npm run test:comfort          # straight, gentle, sharp, S-bend and terrain-profile checks
npm run test:mobile           # touch controls and desktop input at a mobile viewport (dev server required)
npm run test:comfort          # straight, gentle, sharp, S-bend and terrain-profile checks
```

## Known limitations

- Desktop Chrome checks cover synthetic touch input and mobile-sized layouts. **Not tested on real iPhone Safari**; native multi-touch capture, notch safe areas and sustained performance still need device testing.
- Driving is a deliberately simple arcade model with no collisions; trees and props are not solid.
- The Close driving view is still orthographic, so it is tighter and lower rather than a true
  perspective chase camera; low angles can let roadside trees cover the car in corners.
- Trees are not shadowed by other trees, there is no level-of-detail for foliage, and the leaf dabs
  look blocky in extreme close-up.
- Rocks are the weakest asset: plain faceted boulders.
- One small world (400 m square), one biome, one car, no audio.

## Play on mobile

Public game: https://perinchiang.github.io/beyond-the-bend/
Repository: https://github.com/perinchiang/beyond-the-bend

Open the game in Safari and rotate to landscape; no installation is needed.
Touch controls appear on devices with a coarse pointer:

- Hold ◀ / ▶ at bottom-left to steer. Release to ease back toward neutral.
- Touch the vertical throttle at right and slide up/down for 0–100% power.
  Position determines power; releasing returns it to zero. Coasting still carries the car forward.
- Hold **Brake** beside the throttle to slow down.
- Steering, throttle and brake accept separate fingers simultaneously.
- Tap **Driving / Free** at top-right to switch cameras. In Free mode, drag the scenery to orbit.
- Tap **High / Normal / Close** to cycle the driving view. This button is disabled in Free mode.

Keyboard controls are unchanged. Touch input resets on cancellation, capture loss, backgrounding,
window blur and resize/rotation. Safe-area insets keep controls away from the notch/home indicator.
On mobile the existing low-quality preset is selected by default (1024px shadows, existing reduced
scatter/paint settings and tilt blur off); DPR is capped at 1.5 and rendering at 1.6 million pixels.
The same painterly shader/post-processing pipeline is retained. Desktop quality defaults are unchanged.

## Deployment

The Pages workflow builds with Node 22 and npm ci, then publishes dist using GitHub's official
Pages actions. Every push to main deploys; workflow_dispatch allows manual redeployment.
Vite defaults to /beyond-the-bend/ locally. CI uses configure-pages' base_path, so the generated
scripts, styles and car GLB share the correct Pages prefix. The GLB uses import.meta.env.BASE_URL.

In repository **Settings → Pages → Build and deployment**, the source must be **GitHub Actions**.
Actions must be enabled for this repository. The deploy job requires pages:write and id-token:write;
if an organization restricts these, an administrator must allow the official Pages actions and
approve the github-pages environment. Never publish credentials in the repository.

For a local production check:

    npm run typecheck
    npm run build
    npm run preview -- --port 5184
    # Open http://127.0.0.1:5184/beyond-the-bend/

The exported browser-context function in tools/mobile-check.mjs can be passed to a browser
runner's page.evaluate after window.__btb.ready. It checks analog values reaching the vehicle,
simultaneous inputs, independent releases, pointer cancellation/capture-loss events, blur/resize,
camera buttons, desktop keys, camera/vehicle independence, control bounds and the GLB path.
It temporarily stubs capture for synthetic pointers and forces coarse-pointer CSS for inspection;
reload after running. It does not prove native Safari pointer capture or real-device performance.
