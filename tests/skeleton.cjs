'use strict';
// Synthetic skeletons shared by the tests. They exercise counting logic only; they say nothing
// about how well the pose model sees a real person lifting a kettlebell on a real iPhone.
const STEP = 50, ASPECT = 4 / 3; // 20 fps
const TOP = .9, BOTTOM = -.3;

function skeleton({ s, torso = .25, cx = .5, hipY = .55, wrists = 'both', visibility = 1 } = {}) {
 const lm = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 0, presence: 0 }));
 const set = (i, x, y, v = 1) => { lm[i] = { x, y, z: 0, visibility: v, presence: v } };
 const shoulderY = hipY - torso, half = torso * .55 / ASPECT;
 set(11, cx + half, shoulderY); set(12, cx - half, shoulderY); set(23, cx + half * .7, hipY); set(24, cx - half * .7, hipY);
 const wy = hipY - s * torso;
 set(13, cx + half * 1.3, (shoulderY + wy) / 2); set(14, cx - half * 1.3, (shoulderY + wy) / 2);
 set(15, cx + .02, wy, wrists === 'right' ? .05 : visibility); set(16, cx - .02, wy, wrists === 'left' ? .05 : visibility);
 if (wrists === 'none') { set(15, cx, wy, .05); set(16, cx, wy, .05) }
 return lm;
}
const wave = (t, period, top = TOP, bottom = BOTTOM, phase0 = 0) => (top + bottom) / 2 + (top - bottom) / 2 * Math.cos(2 * Math.PI * t / period + phase0);

// Squat: the whole upper body drops by `drop` torso lengths (front camera, standing in view).
function squatSkeleton({ drop = 0, torso = .25, cx = .5, shoulderY = .3, visibility = 1 } = {}) {
 const lm = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 0, presence: 0 })), set = (i, x, y, v = visibility) => { lm[i] = { x, y, z: 0, visibility: v, presence: v } };
 const dy = drop * torso, sy = shoulderY + dy, hy = shoulderY + torso + dy, half = torso * .55 / ASPECT;
 set(11, cx + half, sy); set(12, cx - half, sy); set(23, cx + half * .7, hy); set(24, cx - half * .7, hy); set(13, cx + half * 1.3, sy + torso * .3 + dy * .1); set(14, cx - half * 1.3, sy + torso * .3 + dy * .1);
 set(15, cx + half * 1.3, sy + torso * .55); set(16, cx - half * 1.3, sy + torso * .55); return lm;
}
// Push-up, camera low in front: wrists stay on the floor, shoulders rise and fall. `h` = shoulder height above the wrists in shoulder widths.
function pushupSkeleton({ h = 1.6, width = .32, cx = .5, floorY = .75, wrists = 'both', visibility = 1 } = {}) {
 const lm = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 0, presence: 0 })), set = (i, x, y, v = visibility) => { lm[i] = { x, y, z: 0, visibility: v, presence: v } };
 const half = width / ASPECT / 2, sy = floorY - h * width;
 set(11, cx + half, sy); set(12, cx - half, sy); set(13, cx + half * 1.5, (sy + floorY) / 2); set(14, cx - half * 1.5, (sy + floorY) / 2);
 set(15, cx + half * 1.2, floorY, wrists === 'right' ? .05 : visibility); set(16, cx - half * 1.2, floorY, wrists === 'left' ? .05 : visibility); if (wrists === 'none') { set(15, cx, floorY, .05); set(16, cx, floorY, .05) }
 set(23, cx + half * .6, sy + .08); set(24, cx - half * .6, sy + .08); return lm;
}
module.exports = { STEP, ASPECT, TOP, BOTTOM, skeleton, squatSkeleton, pushupSkeleton, wave };
