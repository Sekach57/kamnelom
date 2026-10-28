'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path');
const root=path.resolve(__dirname,'..'),rowing=process.argv.includes('--rowing');
const cwd=rowing?path.join(root,'reference','strumok'):root;
const tests=rowing?['detector']:['detector','calibration','game','onboarding'];
for(const name of tests){const r=spawnSync(process.execPath,[`tests/${name}.cjs`],{cwd,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1)}
