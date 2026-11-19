# Beyond the Bend

A scenic free-driving and exploration game in development. Landscapes invite you to set off; driving makes you want to keep going. The current countryside prototype contains experiments that do not yet fully match this direction.

## 项目定调 / Current direction · 2026-11-19

> 风景吸引我出发，驾驶让我不想停车。

### 已确认的体验目标

- **驾驶乐趣与自由探索并重。** 玩家可以选择岔路、绕路、掉头、停留；出发首先因为想开车、想接近一处风景，不以接单、交付或金币作为基本动机。参考《极限竞速：地平线》的自由与旷野感，不承诺同等地图规模或制作体量。
- **开阔、田野感强的巡游节奏。** 大部分时间是能持续踩油门加速的直路、长缓弯与起伏路段；普通缓弯轻微松油即可通过；偶尔出现连续的大 S 弯，让可控漂移成为技巧点，而不是每个弯都要求急刹或漂移。
- **地形参与驾驶。** 长坡、坡顶、谷地与不同生态应带来视野和驾驶变化；车辆应有接地、随坡俯仰、适当条件下腾空与落地的反馈。这些是目标，不代表当前车辆已经有完整离地物理。
- **自然风景是主角。** 大部分画面由地形、田野、树群、水体、天空和远景构成。建筑尽量少，以远处、低存在感的风景点缀为主；不建设密集近景村镇，不用巨大邮局标识或任务图标组织风景。

### 美术与生产边界

- **保留现有地面中已被认可的绘画表现作为起点。** 延续其大色块、克制笔触、随地形变化的冷暖与空间层次；先解决树、岩石等与它不协调的问题。不要为了让新资产显得协调，先重画整片地面或用重调色、强景深掩盖问题。第一步仍需保存并确认具体基准画面。
- **环境美术以代码为主，尽量少依赖手工建模。** 允许程序生成网格、枝干与树冠、Canvas/Shader 笔触与纹理、参数化变体和有规则的摆放。这里的“纯代码优先”不是“没有 3D 形体”，也不是随意堆球、撒噪声或复制同一张树图。
- **车辆允许建模。** 可以保留或改进现有 Blender → GLB 车辆管线；环境不因此转成大量逐件手工建模。建筑即使采用简单程序形体，也服从少量、远景、不抢主体的约束。
- **原始视觉参考是 [notjignes 的风景作品](https://x.com/notjignes/status/2113958988949942538)。** 参考色域、笔触、形体简化与整体一致性，不把其高俯视展示镜头直接当成驾驶镜头，也不宣称作者所有资产均由纯代码生成。Art of Rally 等漂亮截图不等于已批准替换当前画风。
- **完整环境画风与具体算法仍需实机验证。** “水粉”“油画”“低模”“微缩模型”都不能单独充当验收标准；生图素材、第三方生成器或新 Shader 都只是候选工具，不自动代表更接近目标。外部资源复用须核实许可。

### 当前原型不等于最终定位

现有送货、人物对白、金币、车库、通行进度、邮局村舍以及分区美术是已实现的实验；是否保留另行评估。它们不构成继续扩展送货主循环、近景建筑或城镇玩法的默认授权。本次定调不删除这些实现，也不宣称全世界的美术已经统一。

下一步按 [程序化绘画美术研究与验证 issue #3](https://github.com/perinchiang/beyond-the-bend/issues/3) 工作：先固定地面基准，在同一地面、光照与正常驾驶镜头下比较少量资产样板；通过视觉、动态稳定性与性能检查，并由 Patrick 确认样板后，才推广到整条路线与更多生态。研究结论、样板结果和已确认方向必须分开记录。

**文档优先级：** Patrick 最新明确要求 → 本节已确认目标 → 上述 issue 的研究与验收记录。旧 [ROADMAP.md](ROADMAP.md) 保留历史实验与待办，其“接差事为主线”“玩法/正式画风全部已确定”及旧排期不再代表当前定调；开始后续实施前需对齐。以下运行方法、控制、镜头数值和渲染说明描述当前版本，不是对最终设计的承诺。讨论候选方案不能被记录为用户已经批准，新增功能不能反过来定义游戏。

Stack: Three.js (r187) · TypeScript · WebGL 2 · Vite. Environment: code-first procedural geometry and shaders; vehicle exception: Blender Python → GLB.

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5183/beyond-the-bend/
npm run build        # type-check + production bundle
npm run car          # regenerate public/models/car.glb with Blender (needs `blender` on PATH)
```

## Controls (current prototype)

| | |
|---|---|
| `W A S D` / arrows | drive (steering is always relative to the car) |
| `Space` / `Shift` | service brake / handbrake |
| `E` (driving) | use the nearby delivery, gate or challenge |
| `C` | switch **Driving camera** ⇄ **Free camera** |
| `V` | cycle driving view: **High → Normal → Close** (Driving camera only) |
| drag / `Q E` · `R F` · wheel / `Z X` · shift-drag | orbit · tilt · zoom · pan (**Free camera only**) |
| `T` | miniature lens on/off |
| `H` | hide the legend |

Driving sound starts on the first keyboard or touch gesture. Web Audio synthesizes the engine, tyre noise and grass rustle from the car’s speed, throttle and ground contact. Open **Pause** to freeze the drive and mute driving sounds. **Resume drive** continues from the same position and speed. The mute preference is remembered on this device.

The upper-left HUD shows speed in km/h and a north-up road map. The red arrow tracks the car, including off-road, and the diamond marks the current destination. Tap **Map** to collapse it. With `?debug=1`, the upper-right **Debug** selector lists the build ID and travel points for all routes.

### Existing route and delivery experiment

The following describes how the existing experiment works, not a required delivery-first player journey.

The main entrance starts in Close view at the village exit. Follow the hayfield road through its broad bend to the clock tower at Foothill Station (306 m), then keep driving to return through the hills. Stop by the village envelope sign, choose **Talk to Mara** (or press **E**), then sign for the station parcel. You can leave the counter before signing. The first station delivery earns 100 coins. Bring the porter's timetables back to Mara for a stamped receipt and another 35 coins. The pause menu holds the guide switch, garage, engine tune and unlocked passes. Return mail offers a trip back to town. At the end of the rice fields the left fork leads through Cedar Pass to the old sawmill. This 303 m gravel road crosses a timber bridge over Mill Brook and rejoins the original road on the north ridge. The first delivery adds guidance through the fields; the physical junction is always open. The remaining districts and Sunset Arcade are separate playable studies reached at their marked exits. The old hill sprint starts at the meadow bend. The local logbook saves purchases, deliveries and event records. Reloading starts the current map at its entrance. Use `?route=circuit` for the earlier road layout in gouache. For the earlier diorama, use `?study=original`. The [Close comparison](public/studies/close.html) includes the oil, print and gouache studies.

URL options: `?cam=free`, `?preset=0|1|2`, `?s=<metres along the road>`, `?q=low|high`,
`?tilt=0`, `?stats=1`, `?hud=0`, `?haze=<0..1>`. `?lens=ortho` restores the old parallel projection
(used by `tools/stability.mjs`, and handy for comparing the two).

A standard gamepad uses the left stick to steer, RT for throttle, LT for braking, the west face button for the handbrake and the south face button to interact. In the touch layout use **Slide** for the handbrake.

Run `npm run test:journey` against the local dev server to exercise deliveries, driving guidance, the garage, six road passages and the timed sprint. Set `BTB_URL` to check a production deployment. Run `npm run package:desktop` for a self-contained offline HTML build in `test-results/desktop/`. On macOS with Xcode command line tools, the command also builds a local WebKit app.

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
  | Normal | 40° | 30° | 44 m | 18 % below centre | 0.52 s |
  | Close (station road) | 22° | 30° | 24 m | 23 % below centre | 0.45 s |

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
readable and keep camera motion smooth. These were references for the existing lens and camera
comfort, not approval to replace the art direction. The current implementation has three driving
presets and adds aerial haze so distance reads as distance, shadows
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

## How the picture is made (current implementation)

This is an inventory of the current mixed implementation, not a claim that every asset already
matches the ground. The terrain's layered washes and restrained strokes are the starting point
for the research issue. Sharing `paintMaterial()` does not automatically give trees, props and
cars the terrain's paint treatment: their geometry, colour hooks and lighting adjustments differ.

| Layer | Source |
|---|---|
| Terrain shape | Procedural height field (fBm + one authored hill and dip), 320×320 grid. The road corridor is cut in with a distance field so verges are flat and embankments ease into the hills. |
| Road | Two hand-authored closed Catmull-Rom splines: the station road and the original 1.3 km circuit. A ribbon mesh carries exact lateral coordinates, so edge lines and dashes are analytic and stay crisp. |
| Terrain paint | Custom GLSL injected into Three's Lambert material: broad gouache washes, brush-dab edges, short grass ticks, dry-brush grain, painted form shading from terrain curvature, earth shoulders, drifting cloud shadows, and a stippled dissolve into paper at the world edge. |
| Textures | World-space noise and brush strokes are baked at startup. Two small Canvas2D atlases hold birch sprays and the broadleaf, fir and thorn brush shapes. |
| Vegetation, rocks | Round-shouldered oak, lime and plum crowns on painted bark, open fir boughs and arching thorn shoots use species-specific silhouettes and painted edges. Low fieldstone ledges share a broken mineral seam across their faces, with moss and grass at the base. Geometry is instanced in 100 m chunks. |
| Roadside | Delineator posts, corner chevrons (placed from spline curvature), post-and-rail fences — one merged mesh. |
| Car | `tools/blender/build_car.py`: a lofted hatchback shell from hand-tuned cross-sections, boolean wheel wells, arch flares, inset glazing, lamps, bumpers, spoiler, lamp pod, separate spoked wheels (~6k triangles). Colours are assigned in code by material name. |
| Light | One warm directional sun with a texel-snapped PCF shadow map and cool hemisphere fill. Tree crowns use authored volume normals and do not receive shadow-map shadows; shrubs, ground cover, rocks and buildings have separate shadow settings. |
| Lens | A 30–36° perspective lens with aerial haze beyond the focal plane. One post chain: half-resolution tilt-shift blur, soft highlight roll-off, mild grade and vignette. |

### Existing village art experiment

At the village post office, a pale clay pull-in leads from the asphalt to the parcel counter beneath a double-sided envelope sign. The four cottages and the orchard use a local gouache treatment. Pigment follows the plaster and roof planes. Along the road, white birches alternate between a swept crown, an open fork and a taller leader; oaks spread sideways and limes grow upright. The [paint on each bough](src/art/postal-orchard.md) supplies its edge and brush marks, while the scene's sun places the gold on the lit side, even on the return drive. The two small pigment and foliage textures are embedded in the build, including the offline version. The station, hills and other routes keep their existing art. This local treatment, including its generated-image foliage atlas, is an experiment to evaluate, not the default production standard for future environments.

## Checks

```bash
npm run shots                 # capture review screenshots into shots/ (needs dev server + Chrome)
node tools/observe.mjs        # drive a stretch on autopilot and tile the frames into a filmstrip
node tools/postal-light-check.mjs # check the same crown under sunlight from opposite sides
node tools/camera-test.mjs    # camera modes, presets, transitions, vehicle independence
node tools/stability.mjs      # pan the camera a whole number of pixels and compare re-aligned frames
npm run test:comfort          # view turning, what the lens does to distance and to turns, terrain profile
npm run test:handling         # key taps, held keys, grass excursions, keyboard-driven laps (no browser needed)
npm run test:mobile           # touch controls and desktop input at a mobile viewport (dev server required)
```

The browser tools read `BTB_URL` (default `http://127.0.0.1:5183/beyond-the-bend/`).

## Known limitations

- Desktop Chrome checks cover synthetic touch input and mobile-sized layouts. **Not tested on real iPhone Safari**; native multi-touch capture, notch safe areas and sustained performance still need device testing.
- Driving uses a simple arcade model with a separate handbrake/slip implementation; trees and props are not solid. The current car follows sampled terrain height rather than simulating a complete airborne/suspension cycle. Convincing crest take-off and landing remain targets to implement and validate.
- In the Close view a tree crown between the lens and the car is thinned out in stipples rather
  than hidden cleanly, and the diorama's paper edge can show at the top of the frame as a pale sky.
- Trees are not shadowed by other trees, there is no level-of-detail for foliage, and the leaf dabs
  look blocky in extreme close-up.
- A small main map plus separate regional studies, not a broad continuous multi-biome world. Vehicle variants reuse the base car GLB; they are not a collection of independently modelled cars. Large-world streaming and sustained target-device performance remain unvalidated.

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
- Open **Pause** and tap **Driving / Free** to switch cameras. In Free mode, drag the scenery to orbit.
- In **Pause**, tap **High / Normal / Close** to cycle the driving view. This button is disabled in Free mode.

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

