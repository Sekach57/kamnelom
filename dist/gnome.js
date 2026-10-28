'use strict';
// Procedural pixel gnome. A look is five picks from 10 variants each (head, hat, torso, beard, legs),
// derived from a seed string, so every player id maps to one stable gnome (10^5 combinations).
// Pure drawing code on a 2D context; coordinates are in "gnome pixels" with the feet at y = 0.
const GNOME_PARTS = {
 skin: [['#d99c69', '#eab47b'], ['#c98a5c', '#dba172'], ['#e8b48a', '#f4c9a3'], ['#a9724d', '#bd8a63'], ['#f0c8a0', '#f8d8b8']],
 // hat: [main, light, shade, style]
 hats: [['#c38c41', '#e8b95f', '#6f593c', 'miner'], ['#8e8a96', '#c7c2cc', '#55525e', 'horns'], ['#b5373d', '#d9585d', '#7c2227', 'cap'], ['#3f7d4e', '#5fa56f', '#2a5636', 'hood'], ['#7a5030', '#9c6d44', '#4e301b', 'flat'], ['#c8453f', '#e86a62', '#8d2b28', 'bandana'], ['#9a9aa6', '#cfcfd8', '#60606a', 'goggles'], ['#6d7380', '#a2a8b6', '#454a55', 'round'], ['#b9a64a', '#e6d27a', '#7d6f2c', 'wings'], ['#6b5646', '#8d7561', '#443628', 'fur']],
 // beard: [main, light, shade, style]
 beards: [['#e3d9b7', '#f6e8c5', '#b8ae99', 'full'], ['#c4571f', '#e5813f', '#8a3a13', 'full'], ['#2d2a33', '#4a4654', '#18161c', 'forked'], ['#9b9aa0', '#c3c2c8', '#6c6b72', 'short'], ['#6a4527', '#8c6038', '#452b15', 'bushy'], ['#d9b45a', '#f0d283', '#a07f33', 'braids'], ['#3f6fb0', '#6592d1', '#264a80', 'full'], ['#f1ecdc', '#ffffff', '#c7c1ad', 'stache'], ['#a8321f', '#d4553d', '#701e12', 'pointy'], ['#3a2c26', '#5a463d', '#211815', 'braids']],
 // torso: [coat, light, apron, belt, pattern]
 torsos: [['#9b5c38', '#c07b43', '#714a36', '#352c2e', 'plain'], ['#3d6a8f', '#5b8db5', '#2a4a66', '#2b2420', 'stripe'], ['#6a8f3d', '#8fb85b', '#4a662a', '#352c2e', 'studs'], ['#8f3d5b', '#b55b7d', '#662a40', '#2b2420', 'plain'], ['#5b5b66', '#82828f', '#3d3d45', '#9b7a3d', 'studs'], ['#b58a3d', '#d9ae5b', '#7d5f2a', '#3a2c26', 'stripe'], ['#3d8f84', '#5bb5a9', '#2a665e', '#352c2e', 'check'], ['#7a3d8f', '#9d5bb5', '#552a66', '#2b2420', 'plain'], ['#8f5b3d', '#b5805b', '#664029', '#c9b177', 'check'], ['#444a8f', '#6a72b5', '#2e3366', '#352c2e', 'stripe']],
 // legs: [trousers, boots, boots light, style]
 legs: [['#402d2e', '#6c4434', '#8a5a40', 'plain'], ['#3a3f52', '#2b2420', '#4a413b', 'patch'], ['#5a4630', '#7a5a3a', '#9a7650', 'stripe'], ['#2f4a3a', '#4a3a2b', '#6a523b', 'plain'], ['#52343a', '#2f2428', '#4d3c42', 'pads'], ['#4a4a55', '#8a6a3a', '#b08d52', 'stripe'], ['#6a4a2a', '#3a2a1c', '#59422d', 'patch'], ['#2a3a58', '#5a3a2a', '#7a5540', 'plain'], ['#5a2f4a', '#33232d', '#52394a', 'pads'], ['#3d3d3d', '#6a5d4a', '#8d7d66', 'stripe']]
};
const gnomeHash = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) } h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return h >>> 0 };
// Look from a seed (any string, e.g. a player id). Same seed, same gnome. Pass explicit picks to override.
function gnomeLook(seed, picks = {}) {
 const pick = (name, n) => picks[name] ?? gnomeHash(seed + ':' + name) % n;
 return { head: pick('head', 10), hat: pick('hat', 10), torso: pick('torso', 10), beard: pick('beard', 10), legs: pick('legs', 10) };
}
const GNOME_DEFAULT = { head: 0, hat: 0, torso: 0, beard: 0, legs: 0 }; // the original gnome of the quarry

// pose: { dx, dy (crouch depth in px), spread (feet apart), tool: 'hammer'|'ram'|'push'|'none', angle (hammer), reach (0 cocked .. 1 extended), hand: [x, y] contact point for 'push' }
function drawGnome(c, look = GNOME_DEFAULT, pose = {}) {
 const R = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h) };
 const P = (pts, col) => { c.fillStyle = col; c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(Math.round(x), Math.round(y)) : c.moveTo(Math.round(x), Math.round(y))); c.closePath(); c.fill() };
 const [skin, skinLight] = GNOME_PARTS.skin[look.head % 5], [hatC, hatL, hatS, hat] = GNOME_PARTS.hats[look.hat];
 const [bC, bL, bS, beard] = GNOME_PARTS.beards[look.beard], [coat, coatL, apron, belt, pattern] = GNOME_PARTS.torsos[look.torso], [pants, boots, bootsL, legStyle] = GNOME_PARTS.legs[look.legs];
 const dy = Math.round(pose.dy || 0), sp = Math.round(pose.spread || 0), tool = pose.tool || 'hammer';
 c.save(); c.translate(Math.round(pose.dx || 0), 0);
 // shadow and legs: the hips drop by dy, the feet stay on the ground and move apart
 R(-28 - sp, 2, 59 + 2 * sp, 5, '#25222b');
 const leg = (x0, x1, bx) => { P([[x0, -14 + dy], [x1, -14 + dy], [bx + 14, -4], [bx, -4]], pants); R(bx - 4, -4, 18, 8, boots); R(bx - 4, -4, 18, 2, bootsL); if (legStyle === 'stripe') R(bx, -9 + dy / 2, 10, 2, bootsL); if (legStyle === 'patch') R(bx + 2, -10 + dy / 2, 6, 5, bootsL); if (legStyle === 'pads') R(bx, -9 + dy * .55, 12, 5, bootsL) };
 leg(-18, -5, -18 - sp); leg(9, 22, 8 + sp);
 // torso, apron, belt, shoulders
 c.save(); c.translate(0, dy);
 R(-18, -40, 40, 29, coat); R(-22, -42, 47, 14, coatL); R(-12, -28, 27, 18, apron); R(-19, -16, 41, 5, belt); R(-1, -18, 8, 8, '#d8a24e'); R(1, -16, 4, 4, '#6b5032');
 if (pattern === 'stripe') for (let i = 0; i < 4; i++) R(-18, -38 + i * 7, 40, 2, coatL);
 if (pattern === 'studs') for (let i = 0; i < 4; i++) { R(-14 + i * 10, -34, 3, 3, '#d8d2c0'); R(-14 + i * 10, -22, 3, 3, '#d8d2c0') }
 if (pattern === 'check') for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2) R(-18 + i * 10, -40 + j * 14, 10, 14, coatL);
 // back arm
 R(-27, -40, 10, 20, apron); R(-28, -27, 11, 10, skin);
 // head: face, nose, eye
 R(-14, -67, 31, 25, skin); R(-9, -60, 26, 18, skinLight); R(15, -56, 9, 7, skinLight); R(11, -60, 4, 4, '#282a31');
 // beard
 const B = { full: () => { R(-13, -48, 29, 17, bC); R(-9, -32, 22, 10, bC); R(-5, -22, 14, 6, bS); R(-13, -48, 7, 17, bS); R(-2, -45, 4, 17, bL); R(8, -45, 4, 14, bL) },
  short: () => { R(-13, -48, 29, 13, bC); R(-9, -36, 22, 5, bC); R(-13, -48, 7, 13, bS); R(-2, -45, 4, 10, bL) },
  bushy: () => { R(-16, -50, 35, 20, bC); R(-13, -32, 29, 8, bC); R(-16, -50, 8, 20, bS); R(2, -46, 5, 6, bL); R(10, -42, 5, 6, bL) },
  forked: () => { R(-13, -48, 29, 14, bC); R(-12, -34, 11, 16, bC); R(4, -34, 11, 16, bC); R(-12, -34, 5, 16, bS); R(-1, -45, 4, 11, bL) },
  pointy: () => { R(-13, -48, 29, 13, bC); P([[-11, -35], [15, -35], [3, -12]], bC); R(-13, -48, 7, 13, bS); R(-1, -45, 4, 11, bL) },
  braids: () => { R(-13, -48, 29, 13, bC); R(-12, -35, 8, 20, bC); R(8, -35, 8, 20, bC); for (let i = 0; i < 4; i++) { R(-12, -33 + i * 5, 8, 2, bS); R(8, -33 + i * 5, 8, 2, bS) } R(-13, -48, 7, 13, bS) },
  stache: () => { R(-4, -49, 24, 6, bC); R(-8, -45, 8, 6, bC); R(14, -45, 8, 5, bC); R(-1, -49, 4, 5, bL); R(-9, -42, 4, 3, bS) } }; B[beard]();
 // headgear
 const H = {
  miner: () => { R(-18, -69, 39, 8, hatC); R(-15, -82, 31, 14, hatL); R(-8, -88, 18, 7, hatL); R(-12, -79, 5, 9, '#f2ce79'); R(-19, -68, 42, 4, hatS); R(2, -76, 9, 9, '#5d5548'); R(4, -74, 5, 5, '#ffe1a0') },
  horns: () => { R(-17, -76, 37, 14, hatC); R(-14, -82, 31, 8, hatL); R(-17, -66, 37, 4, hatS); P([[-17, -74], [-27, -86], [-22, -94], [-13, -80]], '#e8dfc8'); P([[20, -74], [30, -86], [25, -94], [16, -80]], '#e8dfc8') },
  cap: () => { R(-16, -72, 35, 10, hatC); P([[-14, -72], [18, -72], [6, -100], [-2, -100]], hatC); R(-16, -64, 35, 3, hatS); R(-4, -98, 8, 5, hatL) },
  hood: () => { R(-17, -76, 37, 16, hatC); R(-18, -66, 8, 24, hatC); R(14, -66, 8, 18, hatC); R(-13, -82, 28, 8, hatL); R(-17, -64, 37, 3, hatS) },
  flat: () => { R(-18, -70, 39, 6, hatC); R(-14, -76, 31, 8, hatL); R(-20, -66, 44, 3, hatS) },
  bandana: () => { R(-15, -70, 33, 7, hatC); R(-15, -64, 33, 3, hatS); R(-12, -78, 27, 9, '#3a2f2c'); R(16, -66, 9, 5, hatC); R(20, -62, 7, 8, hatL) },
  goggles: () => { R(-14, -74, 31, 8, '#5a4636'); R(-14, -66, 31, 3, hatS); R(-12, -70, 10, 8, hatL); R(3, -70, 10, 8, hatL); R(-10, -68, 6, 5, '#7fd0e0'); R(5, -68, 6, 5, '#7fd0e0') },
  round: () => { R(-17, -74, 37, 14, hatC); R(-13, -82, 29, 9, hatL); R(-9, -86, 21, 5, hatL); R(-18, -64, 39, 4, hatS); R(-1, -90, 5, 5, hatS) },
  wings: () => { R(-16, -74, 33, 12, hatC); R(-12, -80, 25, 7, hatL); R(-17, -64, 35, 3, hatS); P([[-16, -70], [-30, -74], [-26, -84], [-14, -78]], '#f1ecdc'); P([[17, -70], [31, -74], [27, -84], [15, -78]], '#f1ecdc') },
  fur: () => { R(-19, -76, 41, 14, hatC); R(-15, -84, 33, 10, hatL); R(-19, -66, 41, 5, hatS); R(-12, -88, 6, 5, hatL); R(4, -88, 8, 5, hatL) }
 }; H[hat]();
 c.restore();
 // tools and the front arm (drawn above the body, offset by the crouch)
 c.save(); c.translate(0, dy);
 if (tool === 'hammer') { c.save(); c.translate(18, -43); c.rotate(pose.angle ?? -.52); R(0, -3, 47, 6, '#b27b43'); R(5, -3, 31, 2, '#e3b069'); R(3, -5, 11, 10, skinLight); R(37, -15, 19, 28, '#46454f'); R(35, -13, 19, 24, '#aaa2a2'); R(35, -13, 5, 24, '#d1b9a3'); R(40, -13, 14, 5, '#d5c5b3'); R(40, 6, 14, 5, '#726a75'); c.restore() }
 else if (tool === 'ram') { // a log with an iron cap, held at chest height; the legs do the pushing
  R(10, -44, 36, 13, '#8a5a36'); R(10, -44, 36, 3, '#b27b43'); R(22, -44, 3, 13, '#5c3b22'); R(36, -44, 3, 13, '#5c3b22'); R(44, -47, 9, 19, '#8e8a96'); R(44, -47, 3, 19, '#c7c2cc'); R(8, -42, 7, 9, skin); R(26, -42, 7, 9, skin) }
 else if (tool === 'push') { // both hands on the boulder: the arm folds when cocked and straightens on the push
  const reach = pose.reach ?? 1, sx = 16, sy = -40, [hx, hy] = pose.hand || [52, -34], bx = sx + 12, by = sy + 4, tx = bx + (hx - bx) * reach, ty = by + (hy - by) * reach;
  const d = Math.hypot(tx - sx, ty - sy), L = 22, a = Math.min(L, d / 2), h = Math.sqrt(Math.max(0, L * L - a * a)), ex = (sx + tx) / 2 - ((ty - sy) / (d || 1)) * h * (1 - reach * .6), ey = (sy + ty) / 2 + ((tx - sx) / (d || 1)) * h * (1 - reach * .6);
  c.strokeStyle = coat; c.lineWidth = 11; c.lineCap = 'square'; c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke(); c.strokeStyle = skin; c.lineWidth = 9; c.beginPath(); c.moveTo(ex, ey); c.lineTo(tx, ty); c.stroke(); R(tx - 4, ty - 5, 9, 11, skinLight) }
 c.restore(); c.restore();
}
if (typeof module !== 'undefined') module.exports = { gnomeLook, gnomeHash, drawGnome, GNOME_PARTS, GNOME_DEFAULT };
