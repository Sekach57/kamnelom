'use strict';
// Replays a recording exported by the app's diagnostics panel (?debug -> "Скачать данные") through
// the same PoseSwingDetector. Usage: node tools/replay.cjs file.json [key=value option overrides...]
// e.g. node tools/replay.cjs run.json minAmplitude=0.25 minVisibility=0.3
const fs = require('fs'), path = require('path');
const { PoseSwingDetector } = require('../dist/pose-swing.js');
const file = process.argv[2]; if (!file) { console.error('usage: node tools/replay.cjs file.json [option=value ...]'); process.exit(2) }
const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const overrides = Object.fromEntries(process.argv.slice(3).map(a => { const [k, v] = a.split('='); return [k, Number(v)] }));
const log = { cal: [], rejects: [], swings: [], statuses: {} }; let now = 0;
const det = new PoseSwingDetector({
 onCalibration: n => log.cal.push([now, n]), onReject: (r, i) => log.rejects.push([now, r, i]),
 onCalibrated: p => { log.params = p; log.calibratedAt = now; det.startPlay() }, onSwing: t => log.swings.push(t)
}, { ...data.detectorOptions, ...overrides });
det.startCalibration(); let seen = false;
for (const f of data.frames) {
 now = f.t; let lm = null;
 if (f.p) { lm = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 0 })); f.p.forEach((q, i) => { lm[data.points[i]] = { x: q[0], y: q[1], z: 0, visibility: q[2], ...(q[3] === null ? {} : { presence: q[3] }) } }) }
 const r = det.update(lm, f.t, data.aspect); log.statuses[r.status] = (log.statuses[r.status] || 0) + 1; seen = true;
}
const s = t => (t / 1000).toFixed(1) + 'с', n = data.frames.length;
console.log(`Кадров: ${n}, длительность ${n ? s(data.frames[n - 1].t - data.frames[0].t) : '0'}, опции: ${JSON.stringify(overrides)}`);
console.log('Статусы:', Object.entries(log.statuses).map(([k, v]) => `${k} ${v} (${Math.round(v / n * 100)}%)`).join(', '));
console.log('Калибровка:', log.cal.map(([t, k]) => `${k}/3 @${s(t)}`).join(' ') || 'нет циклов');
if (log.rejects.length) console.log('Отказы:', log.rejects.map(([t, r, i]) => `${r} @${s(t)} ${JSON.stringify(i, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v)}`).join('; '));
if (log.params) console.log('Параметры:', JSON.stringify(log.params, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v));
console.log('Свингов после калибровки:', log.swings.length, log.swings.map(s).join(' '));
const app = (data.events || []).filter(e => e.type === 'swing' && e.counted).length; console.log('Засчитано в приложении (в записи):', app);
