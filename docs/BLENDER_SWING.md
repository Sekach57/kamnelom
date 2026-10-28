# Task for a local Claude Code session with Blender MCP: hand-animated swing, squat and push-up

The current in-game animation is a mix of Meshy mocap and code-driven arm solving. It looks wrong (hands do not hold the
hammer, arms pass through the body, the dwarf kneels after the blow). Replace it with proper keyframed clips made in
Blender, with the hammer attached to the rig, so the game only has to play clips.

Read `docs/ART.md` and `docs/BLENDER_HANDS.md` first. The fists are already baked into `dist/assets/dwarf.glb`.

## Rig and files

- `dist/assets/dwarf.glb`: skinned mesh `Mesh_0`, 24 Mixamo-style bones (`Hips, Spine, Spine01, Spine02, neck, Head,
  *Shoulder, *Arm, *ForeArm, *Hand, *UpLeg, *Leg, *Foot, *ToeBase` for Left/Right). Keep every existing bone name.
  Model height about 1.3 m. Armature scaled 0.01.
- `dist/assets/hammer.glb`: the prop (stone-breaking sledgehammer, rectangular iron head, wooden handle).
- Existing clips in the glb (names used by the game; may be replaced, see below): `Heavy_Hammer_Swing`, `air_squat`,
  `push_up`, `kettlebell_swing`, `Axe_Stance`. `dist/assets/dwarf_extra.glb` has `Left_Slash` and `Idle` (animation only).
- Game facing: the boulder is in front of the dwarf. In glTF (Y up) front is +Z, which is -Y in Blender. Export with Y up.
- Game clock: 24 fps. The game plays one "strike" clip per counted rep and shows the boulder taking damage at a fixed
  time into that clip (the impact time below). It then returns to the loop of the ready stance.

## Hammer attachment (important)

Add one extra bone named `Hammer` to the armature, parented to `Hips` (not to a hand). Do not weight any mesh vertices to it.
It carries the hammer's world motion, so you animate the hammer explicitly and put the hands on it with IK constraints.
- Bone origin = the centre of the hammer; local +Y points from the butt of the handle towards the head; local +X is the
  normal of the flat striking face. Bone length about 0.72 m (the game scales the hammer model to this length).
- Parent the hammer mesh to this bone in Blender only to check poses. The final `.glb` must not contain the hammer mesh
  (the game loads `hammer.glb` itself and copies this bone's transform each frame).
- Hands: add IK or Copy Location / Damped Track constraints so the right fist grips the handle near the butt (about 0.1 of
  the length from the butt end) and the left fist about 0.3 of the length from the butt, both fists wrapped around the
  shaft. Bake the result to plain keyframes on the 24 existing bones before export (Object > Animation > Bake Action,
  only the original bones plus `Hammer`, visual keying on, clear constraints on bake).
- Arms must never pass through the torso, head or each other. Check from front, side and top at every key.

## Clips to produce (exact names)

For each exercise one looping **ready** clip and one **strike** clip (one rep). At the first frame of a strike clip the pose
equals the last frame of that exercise's ready clip, and the last frame of the strike clip equals the ready pose again, so
the game can crossfade without a pop. The dwarf stays in place (no root motion, feet do not slide).

### Swing (hammer in both hands, standing in place)
- `swing_ready` (loop, 2 s): hammer held low in front of the pelvis, head of the hammer resting forward-down, arms relaxed,
  feet shoulder-width, a slight breathing motion.
- `swing_hit` (1.2 s = 29 frames at 24 fps). Overhead blow, top to bottom:
  1. frame 0: ready pose.
  2. frame 6 (0.25 s): hammer raised high behind the head, the dwarf leans slightly back, arms stretched up.
  3. frame 12 (0.5 s): IMPACT. Hammer head hits the point 1.0 m in front of his feet at about knee-to-waist height, torso folded
     forward, knees slightly bent, arms extended forward-down.
  4. frames 12-16: short hold on the impact.
  5. frames 16-29: bring the hammer and arms back to the ready pose, standing back up (he must not end kneeling).

### Squat (hammer laid on the floor, hands free)
- `squat_ready` (loop, 2 s): standing, hammer lying on the floor beside the right foot (the `Hammer` bone stays put,
  horizontal on the floor, handle pointing forward), arms hanging, slight breathing.
- `squat_hit` (1.0 s): frame 0 ready; frame 5 deepest squat (hips below the knees, arms stretched forward for balance);
  frame 10 (0.4 s) IMPACT = fully standing with a small forward push of both fists (a stomp/ram feel); then back to ready.

### Push-up (hammer on the floor)
- `pushup_ready` (loop, 2 s): plank position, arms straight, the dwarf lying along the direction of the boulder, hammer on the
  floor beside his hand.
- `pushup_hit` (1.2 s): frame 0 plank; frame 8 chest nearly touches the floor; frame 14 (0.6 s) IMPACT = arms fully extended
  and a slight push forward; then back to plank.
- Position of the body: the dwarf's feet are about 0.9 m behind the usual standing spot, so the head is near the standing spot
  (the game applies this offset itself; build the clip with the body centred on the origin).

Remove the old clips from the exported file (they stay in git history): keep only `swing_ready, swing_hit, squat_ready,
squat_hit, pushup_ready, pushup_hit`. The game will be switched to these names afterwards (see "Game side").

## Export

File > Export > glTF Binary: Y up, include skinning and animations, "Group by NLA track" or all actions exported as separate
animations, no cameras, no lights, no hammer mesh, texture embedded. Overwrite `dist/assets/dwarf.glb`. Target under 6 MB.
Keep a copy of the previous file out of the repository.

## Checks (do all of them before committing)

- Scrub each clip in Blender from 3 sides; arms and hands never intersect the body or head; the fists stay on the handle in
  every swing frame; the dwarf does not slide.
- Re-import the exported glb in a clean Blender scene and confirm the six clips play and names are exact.
- `npm run check` and `npm test` pass (no code changes needed on your side).
- Do not change code in `dist/`; the game side is adapted separately (below).

## Commit

Branch `claude/ecstatic-bohr-qoi77d`. Commit only `dist/assets/dwarf.glb` (and `SHA256SUMS.txt` if regenerated), message like
"Hand-keyed swing, squat and push-up clips". Then `git push origin claude/ecstatic-bohr-qoi77d` and tell the user.

## Game side (done by the cloud session after the push, for reference)

`dist/scene3d.js`: `CLIPS` switches to the six names; the strike clip plays at normal speed and damage is applied at the
impact time (swing 0.5 s, squat 0.4 s, push-up 0.6 s, equal to `TIMING`/`GNOME_TIMING`); the hammer model copies the
`Hammer` bone's world transform each frame; the arm solver and the code-driven hammer path are deleted.
