'use strict';
// Runs dist/app.js in a vm with a fake DOM, a fake camera and a fake pose tracker whose landmarks the test controls.
const fs = require('fs'), vm = require('vm'), path = require('path');
const { PoseSwingDetector, POSE_POINTS } = require('../dist/pose-swing.js'), { SwingCalibration } = require('../dist/calibration.js'), { RemoteLink, PeerLink, parseRoom } = require('../dist/remote.js'), { gnomeLook, drawGnome, gnomePose, GNOME_TIMING, EXERCISE_WEIGHT } = require('../dist/gnome.js');
const noop = () => { };
module.exports = function harness({ loadModel, rtc, Peer, search = '', store = {}, fetchImpl, EventSource } = {}) {
 const h = { listeners: {}, time: 0, stopped: 0, requests: [], els: {}, landmarks: null, loads: 0, frame: 0 };
 const ctx = new Proxy({}, { get: () => noop, set: () => true });
 const el = id => h.els[id] ??= { textContent: '', value: '5', style: {}, dataset: {}, hidden: false, inert: false, focus: noop, scrollIntoView: noop, disabled: false, readyState: 2, videoWidth: 640, videoHeight: 480, currentTime: 0, clientWidth: 320, clientHeight: 240, width: 320, height: 240, play: async () => { }, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, getContext: () => ctx, setAttribute: noop, offsetWidth: 100 };
 const track = { stop() { h.stopped++ } }; h.stream = { getTracks: () => [track], getVideoTracks: () => [track] };
 class FakeTracker {
  constructor(o) { this.delegate = o.delegate; this.landmarker = null; this.resetStats() }
  get ready() { return !!this.landmarker }
  resetStats() { this.stats = { processed: 0, errors: 0, lastMs: 1, avgMs: 1, maxMs: 1, empty: 0 } }
  async load() { h.loads++; if (loadModel) await loadModel(h); this.landmarker = {} }
  detect() { this.stats.processed++; if (h.detectError) { this.stats.errors++; throw new Error('inference') } return { landmarks: h.landmarks, ms: 1 } }
  close() { this.landmarker = null }
 }
 const sandbox = { PoseSwingDetector, POSE_POINTS, gnomeLook, drawGnome, gnomePose, GNOME_TIMING, EXERCISE_WEIGHT, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) } }, confirm: () => true, EventSource: EventSource || class { constructor() { this.closed = true } close() { } }, fetch: (...a) => h.fetchImpl(...a), crypto: require('crypto').webcrypto, SwingCalibration, PoseTracker: FakeTracker, URLSearchParams, location: { search, hash: '', pathname: '/', origin: 'http://test' }, history: { replaceState: noop }, setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t }, clearTimeout, setInterval: () => 0, qrcode: require('../dist/vendor/qr/qrcode.js'),
  Peer, PeerLink: class extends PeerLink { constructor(h, o) { super(h, { Peer, retryMs: 5, timeoutMs: 400, ...o }) } },
  parseRoom, RemoteLink: class extends RemoteLink { constructor(h, o) { super(h, { rtc, gatherMs: 0, ...o }) } },
  document: { hidden: false, head: { appendChild: noop }, getElementById: el, createElement: () => el('sample'), querySelector: () => el('main'), addEventListener: (t, f) => { const prev = h.listeners[t]; h.listeners[t] = prev ? (...a) => { prev(...a); f(...a) } : f }, body: { classList: { add: noop, remove: noop, toggle: noop } } },
  navigator: { mediaDevices: { getUserMedia: async c => { h.requests.push(c); return h.stream } } }, window: { addEventListener: noop }, performance: { now: () => h.time }, requestAnimationFrame: noop, cancelAnimationFrame: noop, console: { ...console, warn: noop } };
 vm.createContext(sandbox); h.fetchImpl = fetchImpl || (async () => { throw new Error('offline') }); h.store = store;
 vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8'), sandbox); vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/social.js'), 'utf8'), sandbox);
 h.sandbox = sandbox; h.el = el; h.run = s => vm.runInContext(s, sandbox);
 // One 50 ms step: a pose frame, then the game/calibration timers.
 h.step = (ms = 50) => { h.time += ms; h.frame++; h.run(`onFrame(${h.time},{presentedFrames:${h.frame}})`); h.run(`tick(${h.time})`) };
 h.advance = (ms, lm) => { for (let i = 0; i < ms; i += 50) { if (lm) h.landmarks = lm(h.time); h.step() } };
 return h;
};
