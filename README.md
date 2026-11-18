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
`?tilt=0`, `?stats=1`, `?hud=0`, `?haze=<0..1>`. `?lens=ortho` restores the old parallel projection
(used by `tools/stability.mjs`, and handy for comparing the two).

### Cameras

Both modes look through the same long "miniature" lens — a real perspective telephoto, not a
parallel projection.

- **Driving (default)** — locked behind the car; the road runs up the screen and the car sits a
  little below centre. No orbit, tilt, zoom or pan: the rig ignores those inputs. The view follows
  the car's position exactly and turns with it through one critically damped spring: no dead zone,
  no overshoot, and quick steering corrections are mostly filtered out. Presets:

  | preset | tilt | lens | view height at the car | car position | yaw time constant |
  |---|---|---|---|---|---|
  | High | 55° | 36° | 66 m | 13 % below centre | 0.60 s |
  | Normal (default) | 40° | 30° | 44 m | 18 % below centre | 0.52 s |
  | Close | 22° | 30° | 24 m | 23 % below centre | 0.45 s |

- **Free / photo** — orbit, tilt, zoom and pan. It follows the car's horizontal position immediately,
  smooths only height over grade changes, and does not track its heading.
  Entering it changes nothing on screen (the driving pose is handed over as-is); leaving it eases
  back behind the car.

The camera only reads the car's pose. `tools/camera-test.mjs` replays a fixed input script with and
without constant mode/preset switching and checks the vehicle ends in a bit-identical state.

#### Why the lens is not orthographic

The first versions used a parallel (orthographic) projection. Still frames looked fine, but in
motion — above all while the view turned to follow the car — the ground on both sides seemed to
tilt and curl upward, as if the road ran along the bottom of a bowl, and the scenery seemed to be
dragged round the car. The terrain was not the cause: measured across the whole lap, the land
beside the road is on average slightly *below* it.

A parallel projection has no vanishing point and no size falloff, so a rotating view carries no
cue for which way the ground is tilted (the same ambiguity as the "spinning dancer" illusion), and
every point pinwheels round the car with the screen edges sweeping fastest. Through a real lens
land recedes and shrinks with distance, the ground reads as flat, and a turn reads as the camera
swinging round behind the car — distant land slides across like an ordinary pan.

[art of rally](https://store.steampowered.com/app/550320/art_of_rally/) and
[Absolute Drift](https://store.steampowered.com/app/320140/Absolute_Drift/) were the references:
both look down through a perspective lens from high behind or above the car, keep the route
readable and keep camera motion smooth. This game keeps its three driving presets and painted
diorama look, and adds what that lens needs: aerial haze so distance reads as distance, shadows
fitted to the lens's footprint, and a stippled dissolve for any tree crown that drifts between
the lens and the car. Handling and input mapping are unchanged.

### Handling

A simple arcade model, tuned to be forgiving with all-or-nothing inputs (keys, touch buttons):

- **Steering is wound on, not switched on.** A held key reaches full lock in about 0.3 s and
  unwinds twice as fast. A quick tap therefore gives a small nudge (an 80 ms tap moves the car
  about 0.35 m sideways over the next second, a 150 ms tap about 1 m) while a held key still
  turns hard.
- **The same key means the same thing at any speed.** Above walking pace the lock shrinks with
  speed so that full lock asks for about 2 g of cornering — a 12 m bend at 15 m/s, a 36 m bend
  flat out — and never more than 80°/s of rotation.
- **A little weight.** The body follows the front wheels with a short lag rather than snapping.
- **Grass slows the car gradually.** The verge is free; beyond it the car bogs down over about
  0.7 s and frees itself in 0.25 s. Clipping the grass costs about 1 % of your speed, cutting
  a corner for a second about 8 %, and staying out there settles at roughly two thirds of
  road speed. Grip is slightly lower on grass.

Acceleration, top speed and braking are as before. `npm run test:handling` measures all of
this and laps the road with a tap-steering keyboard driver that has human reaction time.

## How the picture is made

| Layer | Source |
|---|---|
| Terrain shape | Procedural height field (fBm + one authored hill and dip), 320×320 grid. The road corridor is cut in with a distance field so verges are flat and embankments ease into the hills. |
| Road | Hand-authored closed Catmull-Rom spline (25 control points, 1.3 km). A ribbon mesh carries exact lateral coordinates, so edge lines and dashes are analytic and stay crisp. |
| Terrain paint | Custom GLSL injected into Three's Lambert material: broad gouache washes, brush-dab edges, short grass ticks, dry-brush grain, painted form shading from terrain curvature, earth shoulders, drifting cloud shadows, and a stippled dissolve into paper at the world edge. |
| Textures | World-space noise and brush strokes are baked at startup. Two small Canvas2D atlases hold birch sprays and the broadleaf, fir and thorn brush shapes. |
| Vegetation, rocks | Round-shouldered oak, lime and plum crowns on painted bark, open fir boughs and arching thorn shoots use species-specific silhouettes and painted edges. Low fieldstone ledges share a broken mineral seam across their faces, with moss and grass at the base. Geometry is instanced in 100 m chunks. |
| Roadside | Delineator posts, corner chevrons (placed from spline curvature), post-and-rail fences — one merged mesh. |
| Car | `tools/blender/build_car.py`: a lofted hatchback shell from hand-tuned cross-sections, boolean wheel wells, arch flares, inset glazing, lamps, bumpers, spoiler, lamp pod, separate spoked wheels (~6k triangles). Colours are assigned in code by material name. |
| Light | One warm directional sun with a texel-snapped PCF shadow map, cool hemisphere fill. Foliage is lit by its volume normals and does not receive shadow-map shadows. |
| Lens | A 30–36° perspective lens with aerial haze beyond the focal plane. One post chain: half-resolution tilt-shift blur, soft highlight roll-off, mild grade and vignette. |

## Checks

```bash
npm run shots                 # capture review screenshots into shots/ (needs dev server + Chrome)
node tools/observe.mjs        # drive a stretch on autopilot and tile the frames into a filmstrip
node tools/camera-test.mjs    # camera modes, presets, transitions, vehicle independence
node tools/stability.mjs      # pan the camera a whole number of pixels and compare re-aligned frames
npm run test:comfort          # view turning, what the lens does to distance and to turns, terrain profile
npm run test:handling         # key taps, held keys, grass excursions, keyboard-driven laps (no browser needed)
npm run test:mobile           # touch controls and desktop input at a mobile viewport (dev server required)
```

The browser tools read `BTB_URL` (default `http://127.0.0.1:5183/beyond-the-bend/`).

## Known limitations

- Desktop Chrome checks cover synthetic touch input and mobile-sized layouts. **Not tested on real iPhone Safari**; native multi-touch capture, notch safe areas and sustained performance still need device testing.
- Driving is a deliberately simple arcade model with no collisions and no sliding; trees and props are not solid.
- In the Close view a tree crown between the lens and the car is thinned out in stipples rather
  than hidden cleanly, and the diorama's paper edge can show at the top of the frame as a pale sky.
- Trees are not shadowed by other trees, there is no level-of-detail for foliage, and the leaf dabs
  look blocky in extreme close-up.
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
