'use strict';
// Static wiring check for the Build screen: every element build3d.js looks up exists in index.html, the section is routed and linked,
// and the scripts load in an order that works. (The 3D scene itself needs WebGL and is checked by hand in a browser.)
const assert = require('assert'), fs = require('fs'), path = require('path');
const dist = f => fs.readFileSync(path.join(__dirname, '../dist', f), 'utf8'), html = dist('index.html'), scene = dist('build3d.js'), app = dist('app.js');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const wanted = [...new Set([...scene.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]))];
assert(wanted.length > 10, 'build3d.js looks up its controls by id');
for (const id of wanted) assert(ids.has(id), 'index.html has #' + id + ' (used by build3d.js)');
assert(/<div data-view="build" hidden>/.test(html), 'the Build section exists and starts hidden');
assert(/<a href="#\/build" data-nav="build">/.test(html), 'the navigation links to it');
assert(/const VIEWS=\[[^\]]*'build'[^\]]*\]/.test(app), 'app.js routes #/build');
const order = ['gnome.js', 'app.js', 'stage.js', 'build.js', 'build3d.js'].map(f => html.indexOf('<script src="' + f + '">'));
assert(order.every(i => i >= 0) && order.every((v, i) => !i || v > order[i - 1]), 'scripts load in order: gnome, app, stage, build logic, build scene');
assert(!/getUserMedia|mediaDevices|XMLHttpRequest|WebSocket|sendBeacon|upload|fetch\(/i.test(scene.replace(/\/\/.*$/gm, '')), 'the build screen has no camera-capture, network or upload code yet');
for (const m of ['rubble', 'sandstone', 'brick', 'stone', 'marble', 'obsidian']) assert(scene.includes(m + ':'), 'a look for ' + m);
for (const [file, text] of [['index.html', html], ['build3d.js', scene]]) assert(!/[А-Яа-яЁё]/.test(text.replace(/<!--.*?-->/gs, '')) , file + ': the UI is English');
console.log('PASS: Build screen wiring: ' + wanted.length + ' element ids, route, nav link, script order, no camera-capture or network code, English UI.');
