import * as THREE from 'three';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
import { clone as cloneRig } from './vendor/three/SkeletonUtils.js';

// 3D quarry scene: gnomes (rigged GLB) hit a boulder (GLB). Two cameras: "solo" (three-quarter view)
// and "group" (looking down on a ring of gnomes around one boulder). Animation is procedural on the
// skeleton, driven by the same timing the 2D game uses (wind-up, hit, recover).
const TIMING = { squat: { wind: .16, hit: .25 }, swing: { wind: .2, hit: .29 }, pushup: { wind: .28, hit: .37 } };
const TINTS = ['#ffffff', '#ffd2b8', '#bcd0ff', '#cdeec0', '#ffe49a', '#e2c4ff', '#ffb0bd', '#a8f0e0'];
const HAMMER_LEN = .8; // model units; grip = fraction of the length from the butt
const ease = k => k * k * (3 - 2 * k);
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295 };

let assets = null;
function loadAssets() {
 return assets || (assets = (async () => {
  const loader = new GLTFLoader(), get = u => new Promise((ok, bad) => loader.load(u, ok, undefined, bad));
  const [g, b, h] = await Promise.all([get('assets/dwarf.glb'), get('assets/boulder.glb'), get('assets/hammer.glb')]);
  return { gnome: g, boulder: b, hammer: h };
 })());
}

function radial(inner, outer) {
 const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
 g.addColorStop(0, inner); g.addColorStop(1, outer); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}

function groundTexture() {
 const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
 x.fillStyle = '#3b3036'; x.fillRect(0, 0, 512, 512);
 for (let i = 0; i < 260; i++) { const h = hash('g' + i), a = hash('a' + i), r = 6 + hash('r' + i) * 26; x.fillStyle = `hsla(${18 + h * 20},${10 + a * 10}%,${15 + a * 9}%,.55)`; x.beginPath(); x.ellipse(h * 512, hash('y' + i) * 512, r, r * (.5 + a * .4), a * 3, 0, 7); x.fill() }
 const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t;
}

function tileTexture() {
 const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
 for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const h = hash('t' + i + '_' + j); x.fillStyle = `hsl(${268 + h * 20},${14 + h * 8}%,${20 + h * 11}%)`; x.fillRect(i * 16, j * 16, 16, 16); x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(i * 16, j * 16, 16, 2); x.fillRect(i * 16, j * 16, 2, 16); x.fillStyle = 'rgba(255,255,255,.07)'; x.fillRect(i * 16 + 2, j * 16 + 2, 14, 1) }
 for (let i = 0; i < 40; i++) { x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(hash('d' + i) * 128, hash('e' + i) * 128, 3, 2) }
 const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function strataTexture() {
 const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d');
 for (let j = 0; j < 8; j++) { const h = hash('s' + j); x.fillStyle = `hsl(${20 + h * 14},${16 + h * 10}%,${14 + h * 10}%)`; x.fillRect(0, j * 8, 64, 8) }
 for (let i = 0; i < 60; i++) { x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(hash('u' + i) * 64, hash('v' + i) * 64, 4, 2) }
 const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace; return t;
}

// One deterministic look per player id: proportions, colours and (once the parts exist) beard and helmet.
export function lookFor(id) {
 const r = k => hash(id + '|' + k), pick = (k, n) => Math.floor(r(k) * n);
 return { tint: pick('tint', TINTS.length), h: .92 + r('h') * .14, w: .9 + r('w') * .2, belly: .94 + r('belly') * .18, arm: .95 + r('arm') * .1, beard: pick('beard', 3), helmet: pick('helmet', 3), hair: pick('hair', HAIR.length), metal: pick('metal', METAL.length), rare: r('rare') > .93 };
}
const HAIR = ['#6b3a1e', '#a8321f', '#2b2430', '#8d8a90', '#d9c9a0', '#4a3a28'], METAL = ['#ffffff', '#c9d3ff', '#ffd9a0', '#d8ffe6', '#ffc4c4'];

class Gnome {
 constructor(src, id, scale = 1) {
  this.id = id; this.root = new THREE.Group(); this.look = lookFor(id); this.model = cloneRig(src.scene); this.S = scale; this.pivot = new THREE.Group(); this.root.add(this.pivot); this.model.scale.set(scale * this.look.w, scale * this.look.h, scale * this.look.w); this.pivot.add(this.model);
  const tint = new THREE.Color(TINTS[this.look.tint]), bones = {};
  this.model.traverse(o => {
   if (o.isBone) bones[o.name] = o;
   if (o.isMesh) { o.frustumCulled = false; o.material = o.material.clone(); o.material.color.copy(tint); o.material.metalness = 0; o.material.roughness = .8 }
  });
  const hs = assets.hammer.scene.clone(true), hb = new THREE.Box3().setFromObject(hs), hsz = hb.getSize(new THREE.Vector3());
  hs.scale.setScalar(HAMMER_LEN * scale / Math.max(hsz.x, hsz.y, hsz.z)); hs.updateMatrixWorld(true); hs.position.sub(new THREE.Box3().setFromObject(hs).getCenter(new THREE.Vector3()));
  this.hammer = new THREE.Group(); this.hammer.add(hs); this.root.add(this.hammer); this.hs = hs;
  if (bones.Spine) bones.Spine.scale.set(this.look.belly, 1, this.look.belly);
  for (const k of ['LeftArm', 'RightArm']) if (bones[k]) bones[k].scale.setScalar(1.2 * this.look.arm);
  this.b = bones; this.rest = {}; for (const k in bones) this.rest[k] = bones[k].quaternion.clone();
  this.model.updateMatrixWorld(true); const mq0 = this.model.getWorldQuaternion(new THREE.Quaternion()).invert(); this.footRest = {}; this.footRestQ = {};
  for (const side of ['Left', 'Right']) { const f = bones[side + 'Foot']; if (f) { this.footRest[side] = f.getWorldPosition(new THREE.Vector3()); this.footRestQ[side] = mq0.clone().multiply(f.getWorldQuaternion(new THREE.Quaternion())) } }
  this.P = {}; this.exercise = 'swing';
  this.hitAt = -10; this.ex = 'swing'; this.phase = hash(id) * 6; this.hitDone = true; this.onHit = null;
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.3 * scale, 1.3 * scale), new THREE.MeshBasicMaterial({ map: radial('rgba(0,0,0,.6)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = .01; this.root.add(sh);
 }

 strike(ex, now) { if (TIMING[ex] && ex !== this.exercise) this.setExercise(ex); this.hitAt = now; this.hitDone = false }
 setExercise(ex) { if (KF[ex]) this.exercise = ex }
 // additive rotation on a bone, in its own frame
 rot(name, x = 0, y = 0, z = 0) { const b = this.b[name]; if (b) b.quaternion.copy(this.rest[name]).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))) }
 // Pose engine: each exercise has three key poses (rest, wind-up, hit). The parameters ease toward the blend of
 // those keys, so switching exercise glides from one stance to the other. Arms and legs are solved with two-bone IK.
 update(now, dt) {
  const ex = this.exercise, K = KF[ex], t = TIMING[ex], p = now - this.hitAt, S = this.S;
  let back = 0, slam = 0, striking = false;
  if (p >= 0 && p < t.hit + .5) {
   striking = true;
   if (p < t.wind) back = ease(p / t.wind);
   else if (p < t.hit) { const k = (p - t.wind) / (t.hit - t.wind); back = 1 - k * k; slam = k * k }
   else slam = Math.max(0, 1 - (p - t.hit) / .4);
   if (!this.hitDone && p >= t.hit) { this.hitDone = true; this.onHit && this.onHit(this) }
  }
  const P = this.P, rate = 1 - Math.exp(-dt * (striking ? 28 : 5));
  for (const k in K[0]) { const goal = K[0][k] + back * (K[1][k] - K[0][k]) + slam * (K[2][k] - K[0][k]); P[k] = P[k] === undefined ? goal : P[k] + (goal - P[k]) * rate }
  const breathe = Math.sin(now * 2 + this.phase) * .004;
  this.pivot.rotation.x = P.pitch; this.pivot.position.set(0, 0, P.fwd * S);
  this.model.position.y = -P.hips * S + breathe;
  for (const k of LIMBS) this.b[k] && this.b[k].quaternion.copy(this.rest[k]);
  this.rot('Spine', P.lean * .5, 0, 0); this.rot('Spine01', P.lean * .5, 0, 0); this.rot('Head', -P.lean * .45, 0, 0);
  this.root.updateMatrixWorld(true);
  const root = this.root, W = v => root.localToWorld(v.clone()), mq = this.model.getWorldQuaternion(new THREE.Quaternion());
  const dir = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(mq);
  // legs: planted where they started, so a lowered pelvis bends the knees
  this.legIK('Left', this.pivot.localToWorld(this.footRest.Left.clone()), dir(.25, 0, 1)); this.legIK('Right', this.pivot.localToWorld(this.footRest.Right.clone()), dir(-.25, 0, 1));
  // hammer and hand targets, in the player's (yaw-only) frame
  const L = HAMMER_LEN * S, butt = new THREE.Vector3(P.bx, P.by, P.bz).multiplyScalar(S), hd = new THREE.Vector3(P.hx, P.hy, P.hz).normalize();
  const gR = butt.clone().addScaledVector(hd, .1 * L), gL = butt.clone().addScaledVector(hd, .3 * L);
  const hands = side => {
   const free = new THREE.Vector3(side === 'Left' ? P.lx : -P.lx, P.ly, P.lz).multiplyScalar(S), sh = root.worldToLocal(this.b[side + 'Arm'].getWorldPosition(new THREE.Vector3()));
   const ground = new THREE.Vector3(sh.x, .05 * S, sh.z), f = free.lerp(ground, P.ground);
   return f.lerp(side === 'Left' ? gL : gR, P.hold);
  };
  this.armIK('Left', W(hands('Left')), dir(1, -1, -.3)); this.armIK('Right', W(hands('Right')), dir(-1, -1, -.3));
  this.keepFeetFlat(mq);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(-1, 0, 0), hd).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), P.roll));
  this.hammer.quaternion.copy(q); this.hammer.position.copy(butt).addScaledVector(hd, L / 2);
 }
 armIK(side, target, pole) { ik2(this.b[side + 'Arm'], this.b[side + 'ForeArm'], this.b[side + 'Hand'], target, pole) }
 legIK(side, target, pole) { ik2(this.b[side + 'UpLeg'], this.b[side + 'Leg'], this.b[side + 'Foot'], target, pole) }
 keepFeetFlat(mq) {
  for (const side of ['Left', 'Right']) { const f = this.b[side + 'Foot']; if (!f) continue; const wq = mq.clone().multiply(this.footRestQ[side]), pq = f.parent.getWorldQuaternion(new THREE.Quaternion()); f.quaternion.copy(pq.invert().multiply(wq)); f.updateMatrixWorld(true) }
 }
}

const LIMBS = ['LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
// key poses per exercise: [rest, wind-up, hit]; hammer (b = butt point, h = head direction) is in the player's frame, in model units
const base = { pitch: 0, hips: 0, lean: .06, fwd: 0, hold: 1, ground: 0, bx: 0, by: .8, bz: .28, hx: 0, hy: -.45, hz: .89, roll: 0, lx: .14, ly: 1, lz: .36 };
const mk = o => ({ ...base, ...o });
const FLOOR = { hold: 0, bx: -.55, by: .06, bz: -.2, hx: 0, hy: 0, hz: 1, roll: 0 };
const KF = {
 swing: [mk({}), mk({ lean: -.32, bx: 0, by: 1.15, bz: -.06, hx: 0, hy: .8, hz: -.6 }), mk({ lean: .5, hips: .04, fwd: .06, bx: 0, by: 1, bz: .26, hx: 0, hy: -.38, hz: .92 })],
 squat: [mk({ ...FLOOR }), mk({ ...FLOOR, hips: .4, lean: .34, ly: .84, lz: .4 }), mk({ ...FLOOR, lean: .5, fwd: .16, ly: 1.04, lz: .5 })],
 pushup: [mk({ ...FLOOR, bx: -.7, bz: .2, pitch: 1.12, ground: 1, fwd: -.85 }), mk({ ...FLOOR, bx: -.7, bz: .2, pitch: 1.38, ground: 1, fwd: -.85 }), mk({ ...FLOOR, bx: -.7, bz: .2, pitch: 1.1, ground: 1, fwd: -.8 })],
};

// two-bone IK in world space: bend `lower` toward `pole`, reach `target` with `end`
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function aim(bone, child, to) {
 const bp = bone.getWorldPosition(_a), from = child.getWorldPosition(_b).sub(bp).normalize(), dirv = _c.copy(to).sub(bp).normalize();
 const dq = new THREE.Quaternion().setFromUnitVectors(from, dirv), wq = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(dq), pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
 bone.quaternion.copy(pq.invert().multiply(wq)); bone.updateMatrixWorld(true);
}
function ik2(upper, lower, end, target, pole) {
 if (!upper || !lower || !end) return;
 const A = upper.getWorldPosition(new THREE.Vector3()), B = lower.getWorldPosition(new THREE.Vector3()), C = end.getWorldPosition(new THREE.Vector3());
 const l1 = A.distanceTo(B), l2 = B.distanceTo(C), AT = target.clone().sub(A), dist = Math.min(Math.max(AT.length(), .05), (l1 + l2) * .995), d = AT.normalize();
 const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - a * a)), pp = pole.clone().addScaledVector(d, -pole.dot(d)).normalize();
 const B2 = A.clone().addScaledVector(d, a).addScaledVector(pp, h), T2 = A.clone().addScaledVector(d, dist);
 aim(upper, lower, B2); aim(lower, end, T2);
}

export function create(canvas, opts = {}) {
 const mode = opts.mode || 'solo', group = mode === 'group';
 const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
 renderer.setPixelRatio(1); renderer.toneMapping = THREE.NoToneMapping;
 const scene = new THREE.Scene(); scene.background = new THREE.Color('#0c0a11');
 // isometric camera: orthographic, 30 degrees down; the scene renders small and is upscaled without smoothing
 const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, .1, 80);
 const ELEV = group ? .8 : .52, AZ = 0;
 scene.add(new THREE.HemisphereLight('#b9bfff', '#5b4650', 1.7));
 const sun = new THREE.DirectionalLight('#ffe2bd', 2.6); sun.position.set(-3, 6, 4); scene.add(sun);
 const fill = new THREE.DirectionalLight('#ffcfa0', 1.5); fill.position.set(2, 3, 8); scene.add(fill);
 const glow = new THREE.PointLight('#ff8a3c', 3, 7, 1.6); glow.position.set(0, 1.2, 0); scene.add(glow);
 // diorama: a diamond-shaped stone slab floating in the dark
 const slabW = group ? 9 : 7.4, slab = new THREE.Group(); slab.position.set(group ? 0 : .5, 0, 0); slab.rotation.y = Math.PI / 4; scene.add(slab);
 const top = new THREE.Mesh(new THREE.PlaneGeometry(slabW, slabW), new THREE.MeshStandardMaterial({ map: tileTexture(), roughness: 1 })); top.rotation.x = -Math.PI / 2; slab.add(top);
 const side = new THREE.MeshStandardMaterial({ map: strataTexture(), roughness: 1, flatShading: true }), depth = 1.3;
 const body = new THREE.Mesh(new THREE.BoxGeometry(slabW, depth, slabW), [side, side, new THREE.MeshBasicMaterial({ visible: false }), side, side, side]); body.position.y = -depth / 2 - .005; slab.add(body);
 const chunks = new THREE.Group(); slab.add(chunks);
 for (let i = 0; i < 7; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(.35 + hash('k' + i) * .5, .9 + hash('l' + i) * 1.3, 5), side); const t = hash('m' + i), edge = i % 2 ? 1 : -1; c.rotation.x = Math.PI; c.position.set((t - .5) * slabW * .8, -depth - .4 - hash('n' + i) * .4, edge * slabW * .45); chunks.add(c) }
 // crystals along the slab edge
 const crystalMat = new THREE.MeshStandardMaterial({ color: '#ff9a52', emissive: '#ff5a14', emissiveIntensity: 1, flatShading: true, roughness: .4 });
 for (let i = 0; i < 9; i++) { const a = hash('cx' + i), h = .25 + hash('ch' + i) * .45, c = new THREE.Mesh(new THREE.ConeGeometry(.09 + h * .12, h, 4), crystalMat); const e = i % 4, t = (a - .5) * slabW * .86, o = slabW / 2 - .22; c.position.set(e === 0 ? t : e === 1 ? o : e === 2 ? -t : -o, h / 2, e === 0 ? -o : e === 1 ? t : e === 2 ? o : -t); c.rotation.set((hash('r' + i) - .5) * .5, 0, (hash('s' + i) - .5) * .5); slab.add(c) }
 const flames = [];
 for (const [x, z] of group ? [[-4.1, 0], [4.1, 0]] : [[-1.6, -1.9], [2.6, -1.9]]) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(.05, .07, 1.5, 6), new THREE.MeshStandardMaterial({ color: '#4a3526', roughness: 1 })); post.position.set(x, .75, z); scene.add(post);
  const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('rgba(255,170,70,.95)', 'rgba(255,70,0,0)'), blending: THREE.AdditiveBlending, depthWrite: false })); fl.scale.set(.5, .75, 1); fl.position.set(x, 1.7, z); scene.add(fl);
  const pl = new THREE.PointLight('#ff9448', 3, 9, 1.5); pl.position.set(x, 1.8, z); scene.add(pl); flames.push({ fl, pl });
 }
 // boulder
 const rockScale = group ? 1.7 : 1.9, rockMat = [];
 const rock = new THREE.Group(); scene.add(rock);
 const rockModel = assets.boulder.scene.clone(true); rockModel.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.metalness = 0; o.material.roughness = .9; o.material.emissive = new THREE.Color('#ff6a1a'); o.material.emissiveIntensity = 0; rockMat.push(o.material) } });
 const box = new THREE.Box3().setFromObject(rockModel), size = box.getSize(new THREE.Vector3()); rockModel.scale.setScalar(rockScale / size.y); rockModel.position.set(0, 0, 0);
 rockModel.updateMatrixWorld(true); const b2 = new THREE.Box3().setFromObject(rockModel); rockModel.position.y -= b2.min.y; rock.add(rockModel);
 const rockTop = rockScale;
 rock.position.set(group ? 0 : 1.75, 0, .72);

 // shards
 const SH = 90, shardGeo = new THREE.DodecahedronGeometry(.07, 0), shardMat = new THREE.MeshStandardMaterial({ color: '#5a5560', emissive: '#ff5a14', emissiveIntensity: .08, roughness: .9, flatShading: true });
 const shards = new THREE.InstancedMesh(shardGeo, shardMat, SH); shards.frustumCulled = false; scene.add(shards);
 const sp = Array.from({ length: SH }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, s: 1, r: new THREE.Euler() })), dummy = new THREE.Object3D();
 function burst(n, at, power, spread) {
  let k = 0; for (const s of sp) { if (s.life > 0 || k >= n) continue; k++; s.life = .7 + Math.random() * .7; s.s = .5 + Math.random() * 1.6;
   s.p.copy(at).add(new THREE.Vector3((Math.random() - .5) * spread, Math.random() * spread * .6, (Math.random() - .5) * spread));
   s.v.set((Math.random() - .5) * power, 1.5 + Math.random() * power, (Math.random() - .5) * power) }
 }

 // gnomes
 const gnomes = new Map(); let orbit = 0, now = 0, hp = 1, broken = false, wobble = 0, flash = 0, respawn = 0, shake = 0;
 function layout() {
  const list = [...gnomes.values()], n = list.length;
  list.forEach((g, i) => {
   if (group) { const a = (i / Math.max(1, n)) * Math.PI * 2, r = 2.1 + (n > 8 ? .5 : 0); g.root.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); g.root.rotation.y = -a - Math.PI / 2 }
   else { g.root.position.set(-.5, 0, -.5); g.root.rotation.y = Math.PI / 3 }
  });
 }
 function setGnomes(ids) {
  const want = new Set(ids);
  for (const [id, g] of gnomes) if (!want.has(id)) { scene.remove(g.root); gnomes.delete(id) }
  for (const id of ids) if (!gnomes.has(id)) { const g = new Gnome(assets.gnome, id, group ? .95 : 1.6); g.onHit = hitLanded; gnomes.set(id, g); scene.add(g.root) }
  layout();
 }
 const waves = [], waveMat = new THREE.MeshBasicMaterial({ color: '#ffb067', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
 function shock(g) {
  const m = new THREE.Mesh(new THREE.RingGeometry(.9, 1, 32), waveMat.clone()); m.rotation.x = -Math.PI / 2; m.position.copy(g.root.position).add(new THREE.Vector3(0, .03, 0));
  const to = new THREE.Vector3().subVectors(rock.position, g.root.position).setY(0); m.position.addScaledVector(to.normalize(), .3); scene.add(m); waves.push({ m, t: 0 });
 }
 function hitLanded(g) {
  if (g.exercise !== 'swing') shock(g);
  const dmg = g.dmg || 1; wobble = .5 + dmg * .12; flash = 1; shake = .02 + dmg * .012;
  const at = rock.position.clone(); at.y = rockTop * .5; const away = new THREE.Vector3().subVectors(g.root.position, rock.position).setY(0).normalize();
  at.addScaledVector(away, rockScale * .35); burst(8 + dmg * 5, at, 3 + dmg, .4);
  if (opts.onHit) opts.onHit(g.id, dmg);
 }
 function hit(id, ex, dmg) { const g = gnomes.get(id) || [...gnomes.values()][0]; if (!g) return; g.dmg = dmg; g.strike(ex, now) }
 function setExercise(id, ex) { const g = gnomes.get(id) || [...gnomes.values()][0]; if (g) g.setExercise(ex) }
 function setHp(frac) { hp = Math.max(0, Math.min(1, frac)); if (hp > 0 && broken) { broken = false; respawn = 0 } }
 function breakRock() { if (broken) return; broken = true; burst(70, new THREE.Vector3(rock.position.x, rockTop * .5, rock.position.z), 5, 1.3); flash = 1.5; shake = .08 }
 // shift the framing so the menu panel does not hide the dwarf (fractions of the canvas)
 let shift = { x: 0, y: 0 }, shiftNow = { x: 0, y: 0 };
 function setShift(x, y) { shift.x = x; shift.y = y }
 function applyShift() { if (!rw) return; camera.setViewOffset(rw, rh, -shiftNow.x * rw, -shiftNow.y * rh, rw, rh) }
 let rw = 0, rh = 0, pw = 1, ph = 1, aspect = 1.6;
 const rt = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(2, 2) });
 const post = new THREE.ShaderMaterial({
  uniforms: { tC: { value: rt.texture }, tD: { value: rt.depthTexture }, px: { value: new THREE.Vector2(1, 1) } }, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader: `precision highp float;varying vec2 v;uniform sampler2D tC,tD;uniform vec2 px;
  float bayer(vec2 p){vec2 q=mod(p,4.);float a=mod(q.x,2.),b=mod(q.y,2.);float i=(a*2.+b*3.-2.*a*b)*4.;float c=floor(q.x/2.),d=floor(q.y/2.);return(i+(c*2.+d*3.-2.*c*d))/16.;}
  void main(){
   vec3 c=texture2D(tC,v).rgb;float d=texture2D(tD,v).r;
   float e=0.;vec2 o[4];o[0]=vec2(px.x,0.);o[1]=vec2(-px.x,0.);o[2]=vec2(0.,px.y);o[3]=vec2(0.,-px.y);
   for(int i=0;i<4;i++){float n=texture2D(tD,v+o[i]).r;e=max(e,abs(n-d));}
   c=1.-exp(-c*1.25);c=pow(c,vec3(.4545));
   float l=dot(c,vec3(.3,.59,.11));c=mix(vec3(l),c,1.3);c=(c-.5)*1.12+.5;c=clamp(c,0.,1.);
   c=pow(c,vec3(.88));float L=9.;float t=bayer(gl_FragCoord.xy)-.5;
   c=floor(c*L+.5+t*.35)/L;
   if(e>.008)c=mix(c*.18,vec3(.03,.02,.05),.7);
   gl_FragColor=vec4(c,1.);}`
 });
 const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));
 function resize() {
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 360; if (w === rw && h === rh) return; rw = w; rh = h;
  const k = Math.max(2, Math.round(h / (group ? 300 : 270))); pw = Math.max(2, Math.ceil(w / k)); ph = Math.max(2, Math.ceil(h / k));
  renderer.setSize(pw, ph, false); rt.setSize(pw, ph); post.uniforms.px.value.set(1 / pw, 1 / ph); aspect = w / h;
  const V = group ? Math.max(9.6, 10.6 / aspect) : Math.max(7.2, 6.2 / aspect); camera.top = V / 2; camera.bottom = -V / 2; camera.left = -V / 2 * aspect; camera.right = V / 2 * aspect; camera.updateProjectionMatrix(); applyShift();
 }
 function render(dt) {
  dt = Math.min(dt, .1); now += dt;
  if (Math.abs(shift.x - shiftNow.x) + Math.abs(shift.y - shiftNow.y) > .001) { const k = 1 - Math.exp(-dt * 6); shiftNow.x += (shift.x - shiftNow.x) * k; shiftNow.y += (shift.y - shiftNow.y) * k; applyShift() }
  const tx = group ? 0 : .5, ty = group ? .2 : .9; camera.position.set(tx + Math.sin(AZ) * Math.cos(ELEV) * 30, ty + Math.sin(ELEV) * 30, Math.cos(AZ) * Math.cos(ELEV) * 30); camera.lookAt(tx, ty, 0)
  for (const g of gnomes.values()) g.update(now, dt);
  // boulder: shrinks and glows as it takes damage
  const dmg = 1 - hp, target = broken ? 0 : .62 + hp * .38; respawn = broken ? 0 : respawn + dt;
  const cur = rock.scale.x, grow = broken ? cur + (0 - cur) * Math.min(1, dt * 14) : cur + (target - cur) * Math.min(1, dt * (cur < .3 ? 5 : 12));
  rock.scale.setScalar(Math.max(.001, grow)); rock.visible = grow > .02;
  wobble *= Math.exp(-dt * 7); flash *= Math.exp(-dt * 6); shake *= Math.exp(-dt * 10);
  rock.rotation.z = Math.sin(now * 40) * wobble * .05; rock.rotation.x = Math.cos(now * 33) * wobble * .03;
  for (const m of rockMat) m.emissiveIntensity = dmg * .1 + flash * .06;
  flames.forEach((f, i) => { const k = 1 + Math.sin(now * 11 + i * 3) * .12 + Math.sin(now * 23 + i) * .06; f.pl.intensity = 3.2 * k; f.fl.scale.set(.5 * k, .75 * k, 1) });
  glow.intensity = 2.2 + dmg * 5 + flash * 6 + Math.sin(now * 7) * .25; glow.position.set(rock.position.x, 1, rock.position.z);
  camera.position.x += (Math.random() - .5) * shake * 2; camera.position.y += (Math.random() - .5) * shake * 2;
  sp.forEach((s, i) => { if (s.life > 0) { s.life -= dt; s.v.y -= 9 * dt; s.p.addScaledVector(s.v, dt); if (s.p.y < .04) { s.p.y = .04; s.v.multiplyScalar(.35); s.v.y = Math.abs(s.v.y) * .3 } dummy.position.copy(s.p); dummy.rotation.set(s.p.x * 5, s.p.z * 4, s.life * 6); dummy.scale.setScalar(s.life > 0 ? s.s * Math.min(1, s.life * 3) : 0) } else dummy.scale.setScalar(0); dummy.updateMatrix(); shards.setMatrixAt(i, dummy.matrix) });
  for (let i = waves.length - 1; i >= 0; i--) { const w = waves[i]; w.t += dt; const k = w.t / .5; w.m.scale.setScalar(.3 + k * 2.6); w.m.material.opacity = Math.max(0, .9 * (1 - k)); if (k >= 1) { scene.remove(w.m); w.m.geometry.dispose(); w.m.material.dispose(); waves.splice(i, 1) } }
  shards.instanceMatrix.needsUpdate = true;
  renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null); renderer.render(postScene, postCam);
 }
 // screen position (css px) of a point above a gnome's head, for name tags
 function project(id) { const g = gnomes.get(id); if (!g) return null; const v = new THREE.Vector3(g.root.position.x, 1.75 * g.model.scale.x / 1.25, g.root.position.z).project(camera); return { x: (v.x + 1) / 2 * canvas.clientWidth, y: (1 - v.y) / 2 * canvas.clientHeight, behind: v.z > 1 } }
 function dispose() { renderer.dispose(); renderer.forceContextLoss?.() }
 resize();
 return { setShift, setGnomes, setExercise, project, hit, setHp, breakRock, render, resize, dispose, gnomes, camera, THREE };
}

// Head-and-shoulders portrait of a player's dwarf (one shared offscreen renderer, cached per tint).
let pr = null; const prCache = new Map();
export function portrait(id, px = 96) {
 const key = Math.floor(hash(id) * TINTS.length) + ':' + px; if (prCache.has(key)) return prCache.get(key);
 if (!pr) {
  const canvas = document.createElement('canvas'), renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight('#d8dcff', '#6a5048', 1.8)); const d = new THREE.DirectionalLight('#ffe2bd', 2.6); d.position.set(1.5, 2, 3); sc.add(d);
  pr = { renderer, sc, cam: new THREE.PerspectiveCamera(22, 1, .05, 10) };
 }
 pr.renderer.setSize(px, px, false); const g = new Gnome(assets.gnome, id, 1); g.hammer.visible = false; g.model.updateMatrixWorld(true); pr.sc.add(g.root);
 const head = g.b.Head.getWorldPosition(new THREE.Vector3()); pr.cam.position.set(head.x, head.y + .06, head.z + 1.05); pr.cam.lookAt(head.x, head.y + .02, head.z); pr.cam.updateProjectionMatrix();
 pr.renderer.setClearColor(0, 0); pr.renderer.render(pr.sc, pr.cam); pr.sc.remove(g.root);
 const out = document.createElement('canvas'); out.width = out.height = px; out.getContext('2d').drawImage(pr.renderer.domElement, 0, 0, px, px); prCache.set(key, out); return out;
}

export const ready = loadAssets().then(a => { assets = a; return true });
window.Scene3D = { create, portrait, tint: id => TINTS[Math.floor(hash(id) * TINTS.length)], ready: ready.then(() => true, () => false) };
