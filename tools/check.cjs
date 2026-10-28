'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
for(const folder of ['dist','tests','tools'])for(const name of fs.readdirSync(path.join(root,folder))){if(!/\.(js|cjs)$/.test(name))continue;const r=spawnSync(process.execPath,['--check',path.join(root,folder,name)],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1)}
console.log('All JavaScript syntax checks passed.');
