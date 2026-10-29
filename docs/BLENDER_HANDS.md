# Task for a local Claude Code session with Blender MCP: closed fists on the dwarf

Context: the game (`dist/`, see `docs/ART.md`) shows a dwarf swinging a hammer. The dwarf is `dist/assets/dwarf.glb`:
a Meshy-generated, textured character with one skinned mesh (`Mesh_0`, node `char1`), 24 bones, and five mocap clips.
The rig has **no finger bones**, so the hands are rigid open palms and the hammer handle visibly passes beside them.
Goal: make both hands closed fists, so the handle reads as gripped. Fingers do not need to animate.

## Facts you can rely on

- Bones (Mixamo-style names, must stay exactly as they are, `dist/scene3d.js` looks them up by name):
  `Hips, Spine, Spine01, Spine02, neck, Head, head_end, headfront, LeftShoulder, LeftArm, LeftForeArm, LeftHand,
  RightShoulder, RightArm, RightForeArm, RightHand, LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase, RightUpLeg, RightLeg,
  RightFoot, RightToeBase`, under an `Armature` node. Model height is about 1.3 units; the armature is scaled 0.01.
- Clips (names are used in code, keep them): `Heavy_Hammer_Swing`, `air_squat`, `push_up`, `kettlebell_swing`, `Axe_Stance`.
- The game puts the hammer on the line from the right hand to the left hand, head beyond the left hand. The hammer is a
  separate model (`dist/assets/hammer.glb`); you do not need to touch it.
- The render is pixel art, about 270 px tall, so hands are a few pixels wide. A clean fist silhouette matters more than detail.

## What to do (suggested approach: bake the fist into the mesh)

1. Work on a copy: `dist/assets/dwarf.glb` -> keep the original as `dist/assets/dwarf.original.glb` outside the commit
   (do not commit it; it is 4.6 MB). In Blender: File > Import > glTF 2.0 and import the copy.
2. Add temporary finger bones to both hands (thumb, index, middle, ring, pinky; 2-3 segments each), parented to
   `LeftHand` / `RightHand`. Weight the **hand vertices only** to the new bones (Automatic Weights from the armature, then
   clean up: palm stays on the hand bone, fingers get the finger bones). Do not change weights anywhere else on the body.
3. Pose both hands as fists wrapped around a cylinder (the handle axis runs across the palm, perpendicular to the forearm).
4. Apply the pose to the mesh: duplicate the mesh, apply the Armature modifier on the duplicate (baking the fist
   geometry), keep the original vertex groups of the 24 original bones, and delete the temporary finger bones and the
   finger vertex groups. Re-add the Armature modifier pointing at the original armature. Result: the same 24-bone rig, the
   same animations, a mesh whose hands are fists.
5. Check all five clips still play without stretching at the wrists and forearms (scrub `Heavy_Hammer_Swing` especially).
6. Export File > Export > glTF Binary (.glb): include skinning and animations, all five actions, no cameras/lights, Y up,
   keep the texture embedded. Save as `dist/assets/dwarf.glb` (overwrite). Size target: under 6 MB.

Alternative if the baked approach fails: keep real finger bones and key a constant fist rotation on every finger bone at
frame 0 of each action. Bone names for fingers then follow Mixamo (`LeftHandIndex1`, ...); nothing in the code needs them.

## Checks before committing

```powershell
npm run check
npm test
npm run dev
```

Open http://localhost:4173, choose Swing, press Demo (Start does not work without a camera) and watch the swing: the
handle should pass through the fists at the start, the apex and the impact. Also check Squat and Push-up from the menu.
`window.s` is not exposed in the real page, so judge by eye; a zoomed view helps: browser zoom 300% on the canvas.

## Commit

Branch `claude/ecstatic-bohr-qoi77d`. Commit only `dist/assets/dwarf.glb` (and `SHA256SUMS.txt` if you regenerate it),
message such as "Closed fists on the dwarf". Then `git push origin claude/ecstatic-bohr-qoi77d`.
Do not change code in `dist/` unless a bone name changed; if it did, tell the user, do not rename bones.
