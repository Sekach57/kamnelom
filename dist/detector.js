'use strict';
// Sparse optical flow. This detects image motion, not anatomy or lifting technique.
class SwingDetector {
 constructor(onSwing){this.onSwing=onSwing;this.sensitivity=5;this.reset()}
 reset(){this.prev=null;this.position=0;this.extreme=0;this.phase='down';this.downReady=false;this.lastMove=0;this.lastSwing=-Infinity}
 update(gray,t){if(!this.prev){this.prev=gray;return}const prev=this.prev;this.prev=gray;const votes=[];
 for(let y=16;y<62;y+=9)for(let x=22;x<78;x+=9){let zero=0,texture=0;for(let yy=-3;yy<=3;yy+=2)for(let xx=-3;xx<=3;xx+=2){const k=(y+yy)*96+x+xx;zero+=Math.abs(gray[k]-prev[k]);texture+=Math.abs(prev[k]-prev[k+96])}if(texture<70||zero<65)continue;let best=Infinity,bx=0,by=0;
 for(let dy=-5;dy<=5;dy++)for(let dx=-2;dx<=2;dx++){let error=0;for(let yy=-3;yy<=3;yy+=2)for(let xx=-3;xx<=3;xx+=2)error+=Math.abs(gray[(y+yy)*96+x+xx]-prev[(y+yy-dy)*96+x+xx-dx]);if(error<best){best=error;bx=dx;by=dy}}
 if(best<zero*.75&&Math.abs(by)>Math.abs(bx))votes.push(by)}
 if(votes.length<3){if(t-this.lastMove>1800){this.position=0;this.extreme=0;this.phase='down';this.downReady=false}return}
 votes.sort((a,b)=>a-b);const dy=votes[Math.floor(votes.length/2)];if(!dy)return;this.lastMove=t;this.motion(dy,t)}
 motion(dy,t){this.position+=dy;const threshold=24-this.sensitivity*1.7;
 if(this.phase==='down'){this.extreme=Math.min(this.extreme,this.position);if(this.position-this.extreme>threshold){this.phase='up';this.extreme=this.position}}
 else{this.extreme=Math.max(this.extreme,this.position);if(this.extreme-this.position>threshold){if(t-this.lastSwing>800){this.onSwing(t);this.lastSwing=t}this.phase='down';this.extreme=this.position}}
 if(Math.abs(this.position)>10000){this.extreme-=this.position;this.position=0}}
}
if(typeof module!=='undefined')module.exports={SwingDetector};
