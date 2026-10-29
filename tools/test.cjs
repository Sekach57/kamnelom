'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path');
const root=path.resolve(__dirname,'..'),rowing=process.argv.includes('--rowing');
const cwd=rowing?path.join(root,'reference','strumok'):root;
const tests=rowing?['detector']:['build','build_page','pose','calibration','game','onboarding','replay','remote','exercises','exercise_app'];
for(const name of tests){const r=spawnSync(process.execPath,[`tests/${name}.cjs`],{cwd,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1)}
// Server and client+server tests need node:sqlite (Node 22.13+); older Node only checks the game itself.
const [major,minor]=process.versions.node.split('.').map(Number);
if(!rowing){if(major>22||(major===22&&minor>=13)){for(const f of ['server/test.cjs','tests/social.cjs']){const r=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',f],{cwd,stdio:'inherit'});if(r.status!==0)process.exit(r.status||1)}}else console.log('SKIP: server tests need Node 22.13+ (node:sqlite)')}
