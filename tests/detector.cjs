const assert=require('assert');const {SwingDetector}=require('../dist/detector.js');
function frame(sx,sy){const f=new Uint8Array(6912);for(let y=0;y<72;y++)for(let x=0;x<96;x++){const xx=x-sx,yy=y-sy;f[y*96+x]=((xx*7919+yy*104729)^(xx*xx*71+yy*31))&255}return f}
let n=0,t=0;const d=new SwingDetector(()=>n++);
for(let i=0;i<100;i++)d.update(frame(0,0),t+=100);assert.equal(n,0,'static scene');
for(let cycle=0;cycle<5;cycle++){for(let y=0;y<30;y++)d.update(frame(0,y),t+=100);for(let y=30;y>0;y--)d.update(frame(0,y),t+=100)}assert.equal(n,5,'five full vertical cycles');
d.reset();n=0;for(let i=0;i<5;i++){for(let x=0;x<25;x++)d.update(frame(x,0),t+=100);for(let x=25;x>0;x--)d.update(frame(x,0),t+=100)}assert.equal(n,0,'horizontal motion should not trigger vertical swings');
d.reset();for(let i=0;i<100;i++){d.motion(i%2?1:-1,t+=100)}assert.equal(n,0,'small jitter');
d.reset();d.motion(20,t+=100);assert.equal(n,0,'down movement alone is not a swing');d.motion(-20,t+=100);assert.equal(n,1,'return completes the cycle');
console.log('PASS: static scene; five vertical cycles = five swings; horizontal movement ignored; jitter ignored; full cycle required. Real iPhone video still needs validation.');
