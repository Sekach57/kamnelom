'use strict';
// MediaPipe Pose Landmarker wrapper (browser only). Pinned build, model and wasm are served from
// ./vendor/mediapipe on the same host: see docs/POSE_MODEL.md. Nothing is fetched from a CDN
// and no frame leaves the device. detectForVideo is synchronous, so frames that arrive while it
// runs are simply skipped by the caller: there is no queue of stale frames.
class PoseTracker {
 constructor(options = {}) {
  this.base = options.base || 'vendor/mediapipe';
  this.delegate = options.delegate || 'CPU'; // 'GPU' is opt-in (?delegate=gpu): untested on Safari
  this.timeoutMs = options.timeoutMs || 60000;
  this.landmarker = null; this.loading = null; this.lastT = 0; this.resetStats();
 }
 get ready() { return !!this.landmarker }
 resetStats() { this.stats = { processed: 0, errors: 0, lastMs: 0, avgMs: 0, maxMs: 0, empty: 0, since: 0 } }
 // Resolves when the model is ready. A failure rejects with an Error whose .stage says where it failed, and the next call retries.
 load() {
  if (this.landmarker) return Promise.resolve();
  this.loading ??= this.init().catch(e => { this.loading = null; throw e });
  return this.loading;
 }
 async init() {
  let timer; const stage = s => e => { const err = new Error(e && e.message || String(e)); err.stage = s; err.cause = e; return err };
  const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { stage: 'timeout' })), this.timeoutMs) });
  try {
   const run = async () => {
    const url = p => new URL(this.base + '/' + p, document.baseURI).href;
    const mod = await import(url('vision_bundle.mjs')).catch(e => { throw stage('script')(e) });
    const fileset = await mod.FilesetResolver.forVisionTasks(url('wasm')).catch(e => { throw stage('wasm')(e) });
    this.landmarker = await mod.PoseLandmarker.createFromOptions(fileset, {
     baseOptions: { modelAssetPath: url('pose_landmarker_lite.task'), delegate: this.delegate },
     runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .5
    }).catch(e => { throw stage('model')(e) });
   };
   await Promise.race([run(), guard]);
  } finally { clearTimeout(timer) }
 }
 // Returns {landmarks: [33 normalized points] | null, ms}. Throws if the runtime fails.
 detect(video, t) {
  const st = this.stats, ts = Math.max(Math.round(t), this.lastT + 1); this.lastT = ts;
  const start = performance.now();
  try {
   const res = this.landmarker.detectForVideo(video, ts), ms = performance.now() - start;
   st.processed++; st.lastMs = ms; st.avgMs = st.avgMs ? st.avgMs * .9 + ms * .1 : ms; st.maxMs = Math.max(st.maxMs * .99, ms);
   const landmarks = res.landmarks && res.landmarks[0] || null; if (!landmarks) st.empty++;
   return { landmarks, ms };
  } catch (e) { st.errors++; throw e }
 }
 close() { try { this.landmarker?.close() } catch { } this.landmarker = null; this.loading = null }
}
if (typeof module !== 'undefined') module.exports = { PoseTracker };
