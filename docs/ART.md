# Art and 3D scene (Dwarf Gym)

The UI is English. The product name lives in `dist/index.html` (`<title>`, brand link, calibration header) and
`server/app.js` (default group name, `Dwarf-` nick prefix); change it there.

## Look

Isometric pixel art, produced at runtime: `dist/scene3d.js` renders glTF models with an orthographic camera
(30 degrees down) into a small render target (about 270 px tall), then a post pass quantises the palette,
applies ordered dithering and draws a dark outline from depth edges. The canvas is upscaled with
`image-rendering: pixelated`. `dist/stage.js` connects the scene to `app.js` (solo) and `social.js` (crew view).

- Solo: one dwarf, one boulder, slab diorama. Hooks: `stageStrike`, `stageRock`.
- Crew: dwarves stand in a ring around one shared boulder, name tags are HTML. Hooks: `stageGroupOpen/Update/Close`.
- Leaderboard and profile portraits are rendered from the same model (`portrait()` in `scene3d.js`).
- If WebGL or the assets fail, `body.no3d` shows the old 2D canvases (`gnome.js`). The pose pipeline is not involved.

## Assets (`dist/assets/`)

Generated with Meshy (text-to-3D, then texture, then auto-rig) in October 2026:

| File | Source |
| --- | --- |
| `dwarf.glb` | text-to-3D "stocky veteran dwarf warrior, Warcraft 3 / Gimli style", A-pose, textured, rigged (Mixamo-style bones) |
| `hammer.glb` | text-to-3D "heavy dwarven two-handed sledgehammer", textured |
| `boulder.glb` | text-to-3D "cracked basalt boulder with lava veins", textured |

Animation is procedural on the skeleton (`Gnome.update` in `scene3d.js`); the hammer follows the right hand.
Check Meshy's current licence terms before publishing the assets commercially. The API key is not stored in
this repository and must not be committed. Regenerate with the Meshy API (`/openapi/v2/text-to-3d`, `/openapi/v1/rigging`).

`dist/vendor/three/` holds three.js r160 (MIT) plus GLTFLoader, SkeletonUtils and BufferGeometryUtils.

## Open work

- Real-device check of frame rate on iPhone 13 (WebGL, about 270 px render target).
- Models are about 12 MB in total; texture downscaling would shrink first load.
- Per-player look is a colour tint only; more variants need more generated models.

## Animation (updated)

`assets/dwarf.glb` now carries mocap clips from Meshy's animation library (Animation API, `action_ids` 128 Heavy Hammer Swing,
319 Air Squat, 329 Push Up, 327 Kettlebell Swing, 85 Axe Stance; about 3 credits each). `Gnome` in `scene3d.js` plays them with
a `THREE.AnimationMixer`: a ready stance per exercise, then a segment of the clip per rep, with the impact landing at
`TIMING[ex].hit` (keep it equal to `GNOME_TIMING` in `gnome.js`, the game's damage uses it). The hammer follows the right hand
for swings and lies on the floor for squats and push-ups. The earlier hand-written IK pose engine was removed.

## Swing animation (side blow)

The swing uses the `Left_Slash` clip (Meshy animation library, action 97), stored on its own in `assets/dwarf_extra.glb`
(animation only, 58 KB; made by stripping the mesh from the Meshy export). It binds to the dwarf by bone name. In the ready
stance he holds the hammer by the butt with both hands, low and centred; the blow swings in from his side and lands at
`TIMING.swing.hit` (0.5 s). Other candidates tried: Heavy Hammer Swing (overhead), Golf Drive, Reaping Swing, Charged Slash.
The hammer follows the forearms (`HAMMER_BUTT`, `HAMMER_TILT` in `scene3d.js`).
