'use strict';
const $=id=>document.getElementById(id),canvas=$('world'),ctx=canvas.getContext('2d');
let mode='idle',paused=false,count=0,broken=0,hp=20,elapsed=0,strokes=[],lastSwing=-Infinity,lastDemo=0,stream=null,wake=null,lastTime=performance.now(),gameTime=0,hitAt=-10,pendingHit=false,respawnAt=Infinity,particles=[],shake=0,soundOn=false,audioContext=null,requestGeneration=0,frameHandle=null,modelFailed=false,hintSince=0,lastStatus='no_person',rejectHint='',rejectAt=-Infinity,statusFrames={},lastStats=0,presentedBase=null,fileRun=0,lastReject='-',lastDebug=0,debugOn=new URLSearchParams(location.search).has('debug'),sigHistory=[],lastVideoTime=-1,frameErrors=0,okSince=0,badSince=0,buttonReady=false;
// Player identity: a random id kept on this device; it also picks this player's gnome.
function loadProfile(){try{let id=localStorage.getItem('kamnelom.player');if(!id){const a=new Uint8Array(8);crypto.getRandomValues(a);id='p-'+Array.from(a,x=>(x%36).toString(36)).join('');localStorage.setItem('kamnelom.player',id)}return {id}}catch{return {id:'p-guest'}}}
const profile=loadProfile();let myLook=gnomeLook(profile.id);
let exercise='swing';
const EX={
 swing:{title:'Kettlebell swings',unit:'SWINGS',rate:'SWINGS / MIN',rock:'A swing hits twice as hard as a squat: 10 swings break a boulder',pos:'Put the phone in front of you. Step back so your shoulders, arms and hips are visible and your wrists stay in frame at the bottom. The button unlocks when I see you.',count:'Keep the phone still. Do three practice swings now: down and back to the chest.',check:'Do a full swing down and back to the chest. Practice swings don\'t count in the game.',fail:'I didn\'t see three full down-and-up cycles. Step back so your shoulders, arms and hips are visible, and swing evenly from chest to the bottom.',start:'Turn on the front camera, find yourself in frame and do three practice swings.',again:'Turn on the front camera and try three practice swings.',pushed:'One full swing, one strike.'},
 squat:{title:'Squats',unit:'SQUATS',rate:'SQUATS / MIN',rock:'A squat is the lightest hit (1 damage): 20 squats break a boulder',pos:'Put the phone in front of you at chest height. Step back so your shoulders and hips stay visible in every position, and stand straight. The button unlocks when I see you.',count:'Keep the phone still. Do three practice squats now: all the way down and fully up.',check:'Squat down and stand fully up. Keep your shoulders and hips in frame.',fail:'I didn\'t see three full squats. Make sure shoulders and hips stay visible, squat deeper and stand all the way up.',start:'Turn on the front camera, stand so your shoulders and hips are visible, and do three practice squats.',again:'Turn on the front camera and try three practice squats.',pushed:'One full squat, one ram.'},
 pushup:{title:'Push-ups',unit:'PUSH-UPS',rate:'PUSH-UPS / MIN',rock:'A push-up is the heaviest hit (3 damage): 7 push-ups break a boulder',pos:'Lay the phone on the floor facing you and get into a plank facing the camera. Shoulders and hands must stay in frame at the top and bottom. The button unlocks when I see you.',count:'Keep the phone still. Do three practice push-ups now: down and back to straight arms.',check:'Lower down and press up to straight arms. Keep shoulders and hands in frame.',fail:'I didn\'t see three full push-ups. Make sure shoulders and hands stay visible; phone on the floor facing your chest.',start:'Put the phone on the floor, get into a plank facing the camera and do three practice push-ups.',again:'Turn on the front camera and try three practice push-ups.',pushed:'One full push-up, one shove.'}
};
let screenPid=null,screenLook=null,role='solo',link=null,remoteInfo=null,remoteSeen=0,curHint='',pairGeneration=0;
const modelDelegate=new URLSearchParams(location.search).get('delegate')==='gpu'?'GPU':'CPU';
const tracker=new PoseTracker({delegate:modelDelegate});
const calibration=new SwingCalibration(renderCalibration,startCameraGame,renderProgress);
// Trial swings only advance the calibration; in the game each full cycle is one hit.
let detector=makeDetector();
function makeDetector(){return new PoseSwingDetector({onSwing:t=>{recEvent('swing',{counted:mode==='camera'&&calibration.state==='active'});if(mode==='camera'&&calibration.state==='active')swing(t)},onCalibration:n=>{recEvent('cal',{n});calibration.trial(n)},onCalibrated:()=>{recEvent('calibrated',{params:detector.params});calibration.accept()},onReject:(reason,info)=>{lastReject=reason+' '+JSON.stringify(info,(k,v)=>typeof v==='number'?+v.toFixed(2):v);recEvent('reject',{reason,info});rejectHint=REJECT[reason]||'';rejectAt=performance.now();showHint(rejectHint)}},{exercise})}
const HINTS={no_person:'I can\'t see you. Stand in front of the phone so your shoulders, arms and hips are visible.',body_weak:'Shoulders or hips are hard to see. Add light and step back a little.',out_of_frame:'Part of you is out of frame. Step back: I need shoulders, hips and the bottom of the swing.',too_far:'You\'re too far away. Move closer to the phone.',hands_lost:'I can\'t see your wrists. Keep the arms holding the bell visible, don\'t hide them behind your body.',hands_outside:'The bottom is out of frame: wrists leave the edge. Step back or raise the phone.',camera_moved:'The frame changed: the phone or you moved. Go back to your spot or tap "Camera again".'};
const REJECT={small:'Swing too small: lower the bell further and bring it back to your chest.',fast:'Too fast: keep your swings even, down and back to the chest.',slow:'Too slow: swing without a long pause at the bottom.'};
function setBtn(id,t){const e=$(id),l=e.querySelector?.('.lbl');e.title=t;e.setAttribute('aria-label',t);if(l)l.textContent=t;else e.textContent=t}
function stageGnomeId(){return screenPid||profile.id}
function say(s){$('status').textContent=s}
function adoptProfileId(id){try{localStorage.setItem('kamnelom.player',id)}catch{}profile.id=id;myLook=gnomeLook(id);if(typeof renderProfile==='function')renderProfile()}
let pendingDmg=1;
function swing(t=performance.now()){if(mode==='idle'||paused||t-lastSwing<800||pendingHit)return;lastSwing=t;count++;strokes.push(elapsed);hitAt=gameTime;pendingHit=true;pendingDmg=EXERCISE_WEIGHT[exercise]||1;if(window.stageStrike)stageStrike(exercise,pendingDmg);$('count').textContent=count;if(role==='phone'){link?.send({t:'swing',n:count});pushState()}if(mode==='camera'&&typeof socialRep==='function')socialRep(exercise)}
function audio(dmg=1){if(!soundOn||!audioContext)return;try{const a=audioContext,o=a.createOscillator(),g=a.createGain();o.type='triangle';o.frequency.setValueAtTime(120+dmg*15,a.currentTime);o.frequency.exponentialRampToValueAtTime(40,a.currentTime+.17);g.gain.setValueAtTime(.14+dmg*.05,a.currentTime);g.gain.exponentialRampToValueAtTime(.001,a.currentTime+.22);o.connect(g);g.connect(a.destination);o.start();o.stop(a.currentTime+.23)}catch{}}
$('sound').onclick=async()=>{soundOn=!soundOn;if(soundOn){try{audioContext??=new(window.AudioContext||window.webkitAudioContext)();await audioContext.resume()}catch{soundOn=false;say('Sound isn\'t available in this browser. The game keeps working.')}}$('sound').setAttribute('aria-pressed',String(soundOn));setBtn('sound',soundOn?'Sound on':'Sound off')};
async function lock(){try{if('wakeLock'in navigator)wake=await navigator.wakeLock.request('screen')}catch{}}
function renderCalibration(state){recEvent('state',{state});const panel=$('calibrationPanel');panel.dataset.state=state;const isOpen=!['idle','active'].includes(state);document.body.classList.toggle('calibrating',isOpen);document.querySelector('main').inert=isOpen;panel.hidden=state==='idle';panel.classList.toggle('compact',state==='active');$('checkSwing').hidden=!['positioning','failed','interrupted'].includes(state);$('retryCamera').hidden=state!=='error';$('retryModel').hidden=state!=='modelError';$('checkSwing').disabled=state==='positioning'&&!buttonReady;$('countdownDisplay').hidden=state!=='countdown';$('gateProgress').style.width=state==='success'?'100%':'0';
const copy={loading:['◉','STEP 1 / POSE MODEL','Loading the model','The body-tracking model is loading onto this device. This happens once per page load.'],modelError:['!','MODEL FAILED TO LOAD','Pose model unavailable','The body-tracking model failed to load. Counting doesn\'t work without it: check your connection and retry.'],requesting:['◉','STEP 1 / FRONT CAMERA','Starting the front camera','Allow camera access. You\'ll see yourself like in a mirror.'],positioning:['↕','STEP 1 / FIND YOURSELF IN FRAME','Find yourself in frame',EX[exercise].pos],countdown:['↕','STEP 2 / GET READY','Starting in…',EX[exercise].count],checking:['◉','STEP 2 / PRACTICE REPS','Rep 0 / 3',EX[exercise].check],success:['✓','STEP 3 / ALL SET','Reps 3 / 3','Great, three cycles detected. Starting the game: your next rep is the dwarf\'s strike.'],failed:['!','NOT RECOGNISED YET','Let\'s try again',(failHintNow()||EX[exercise].fail)+' Progress: '+calibration.done+' of '+calibration.needed+'.'],interrupted:['!','CHECK INTERRUPTED','Let\'s redo the practice reps','The page was in the background. Make sure you\'re in frame and repeat the check.'],error:['!','CAMERA UNAVAILABLE','Couldn\'t start the camera','Open the site in Safari and allow camera access in the site settings.']};
if(copy[state]){const [icon,step,title,message]=copy[state];$('gateIcon').textContent=icon;$('gateStep').textContent=step;$('gateTitle').textContent=title;$('gateMessage').textContent=message}
$('checkSwing').textContent=state==='positioning'?'I\'m ready, three practice reps':'Try again';if(state==='checking'){detector.startCalibration();statusFrames={};rejectHint=''}else if(['positioning','countdown','failed','interrupted'].includes(state))detector.stop();if(state==='countdown')$('countdownDisplay').textContent='3';pushState();if(['positioning','failed','interrupted'].includes(state))$('checkSwing').focus();}
function startCameraGame(){if(!stream||!detector.params){calibration.set('error');return}mode='camera';paused=false;detector.startPlay();sync();lock();say('Three practice reps recognised. The game has started! Practice reps don\'t count.');$('pause').focus({preventScroll:true});$('arena').scrollIntoView({behavior:'smooth',block:'start'});}
function stopCamera(){requestGeneration++;stopFrames();clearOverlay();showHint('');if(stream)stream.getTracks().forEach(t=>{t.onended=null;t.onmute=null;t.stop()});stream=null;document.body.classList.remove('camera-active');$('video').srcObject=null;$('placeholder').style.display='flex';$('sensorDot').textContent='● OFF';detector.stop();calibration.cancel();}
// --- sections (hash routes #/play, #/party, #/board, #/me) ---
const VIEWS=['play','party','board','me'];let currentView='play';
function showView(name){if(!VIEWS.includes(name))name='play';currentView=name;for(const v of document.querySelectorAll?.('[data-view]')||[])v.hidden=v.dataset.view!==name;for(const a of document.querySelectorAll?.('[data-nav]')||[]){if(a.dataset.nav===name)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')}if(typeof onView==='function')onView(name)}
function goView(name){try{history.replaceState(null,'',location.pathname+location.search+'#/'+name)}catch{}showView(name)}
function routeFromHash(){const m=/^#\/(\w+)$/.exec(location.hash);if(m)showView(m[1]);else if(!location.hash)showView(currentView)}
window.addEventListener('hashchange',routeFromHash);
// --- how we play: on this device, as a big screen for a phone, or as the phone that films for a screen ---
function linkText(){const open=link&&link.open;if(role==='screen')return open?'Phone connected.':'Waiting for the phone: open the link or scan the QR code.';if(role==='phone')return open?'Connected to the screen. Start the camera: the game plays on the big screen.':'The phone isn\'t connected to a screen yet.';return 'Playing on this device.'}
function applyMode(){const m=role==='solo'?'local':role;document.body.dataset.mode=m;for(const [id,k] of [['modeLocal','local'],['modeScreen','screen'],['modePhone','phone']])$(id).setAttribute('aria-pressed',String(k===m));$('linkStatus').textContent=linkText();const wait=role==='phone'&&!(link&&link.open);$('camera').disabled=wait;$('camera').textContent=wait?'Connect to a screen first':stream?'Again':'Start'}
function sync(){ $('pause').disabled=mode==='idle';setBtn('pause',paused?'Resume':'Pause');$('pause').setAttribute('aria-pressed',String(!!paused));$('manual').disabled=mode!=='demo'||paused;$('recalibrate').hidden=!stream;$('modeLabel').textContent=role==='screen'?remoteLabel():mode==='idle'?'CHECK YOUR FORM FIRST':paused?'PAUSED':mode==='demo'?'DEMO · AUTO SWINGS':'CAMERA · SWINGS';$('demo').textContent=mode==='demo'?'Demo running':'Try the demo ↗';$('camera').textContent=stream?'Again':'Start';applyMode();pushState()}
function updateRock(){ if(window.stageRock)stageRock(hp/20);$('rocks').textContent=broken;$('hpText').textContent=hp+' / 20';$('health').style.width=(hp*5)+'%';$('rockTitle').textContent=hp>0?'BOULDER #'+String(broken+1).padStart(2,'0'):'BOULDER SMASHED!';$('rockHint').textContent=hp>0?EX[exercise].rock:'The next boulder is waiting';}
function fresh(){count=0;broken=0;hp=20;elapsed=0;strokes=[];lastSwing=-Infinity;lastDemo=0;gameTime=0;hitAt=-10;pendingHit=false;particles=[];shake=0;respawnAt=Infinity;$('count').textContent='0';$('hitLabel').classList.remove('pop');detector.reset();updateRock()}
$('demo').onclick=()=>{if(role==='screen')leaveRemote();stopCamera();fresh();mode='demo';paused=false;sync();lock();say('Demo: the dwarf strikes on his own. Add hits with the Hit button. 20 hits break a boulder.');};
async function loadModel(){if(tracker.ready){modelFailed=false;return true}try{await tracker.load();modelFailed=false;return true}catch(e){modelFailed=true;console.warn('Pose model failed to load',e.stage,e);return false}}
let modelLoad=null;const ensureModel=()=>modelLoad??=loadModel(); // a failed load is remembered until the user retries
// Camera is already on; make sure the model is loaded before the check. A failed model is never replaced by the old optical-flow detector.
async function enterCheck(generation){if(!tracker.ready){calibration.set('loading');say('Loading the body-tracking model.');if(!await ensureModel()){if(generation===requestGeneration){calibration.set('modelError');say('The pose model didn\'t load. The camera is on; retry the download.')}return}if(generation!==requestGeneration)return}mode='idle';detector.stop();calibration.ready();sync();lock()}
async function openCamera(){
 if(role==='screen')leaveRemote();
 if(stream){mode='idle';paused=false;detector.stop();sync();await enterCheck(requestGeneration);return}
 stopCamera();fresh();mode='idle';paused=false;sync();calibration.set('requesting');$('closeCalibration').focus();
 const generation=++requestGeneration;const b=$('camera');b.disabled=true;say('Setting up the front camera before the game.');if(modelFailed)modelLoad=null;ensureModel(); // model download runs while the permission prompt is open
 let incoming;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
  const base={width:{ideal:640},height:{ideal:480},frameRate:{ideal:20,max:24}};
  try{incoming=await navigator.mediaDevices.getUserMedia({audio:false,video:{...base,facingMode:{exact:'user'}}})}catch(e){if(e.name!=='OverconstrainedError')throw e;incoming=await navigator.mediaDevices.getUserMedia({audio:false,video:{...base,facingMode:{ideal:'user'}}})}
  if(generation!==requestGeneration){incoming.getTracks().forEach(t=>t.stop());return}
  stream=incoming;$('video').srcObject=stream;await $('video').play();if(generation!==requestGeneration)return;
  const track=stream.getVideoTracks()[0];
  track.onended=()=>{stopCamera();mode='idle';paused=false;sync();calibration.set('error');$('gateMessage').textContent='The camera disconnected. Reconnect the front camera and redo the practice swings.'};
  track.onmute=()=>{if(['checking','countdown','success'].includes(calibration.state))calibration.interrupt();else if(mode==='camera'){paused=true;detector.reset();sync();say('The camera is temporarily unavailable. Return to Safari and continue when the image comes back.')}};
  document.body.classList.add('camera-active');$('placeholder').style.display='none';$('sensorDot').textContent='● FRONT CAM';startFrames();await enterCheck(generation);
 }catch(e){if(generation!==requestGeneration)return;stopCamera();calibration.set('error');if(e.name==='NotFoundError')$('gateMessage').textContent='No camera found. Open this page on an iPhone in Safari.';else if(e.name!=='NotAllowedError')$('gateMessage').textContent='Couldn\'t start the camera. Check whether another app is using it and try again.'}finally{b.disabled=false;applyMode()}
}
$('retryModel').onclick=()=>{modelLoad=null;if(!stream){openCamera();return}enterCheck(requestGeneration)};$('camera').onclick=openCamera;$('retryCamera').onclick=openCamera;$('recalibrate').onclick=openCamera;$('checkSwing').onclick=()=>{if(!stream||!tracker.ready){calibration.set('error');return}detector.reset();calibration.begin();lock()};$('closeCalibration').onclick=()=>{stopCamera();mode='idle';paused=false;sync();wake?.release();say('Check cancelled. You can reconnect the front camera.');$('camera').focus()};
$('pause').onclick=()=>{if(role==='screen'){link?.send({t:'cmd',c:paused?'resume':'pause'});return}paused=!paused;detector.reset();sync();if(!paused)lock();else wake?.release();say(paused?'Paused. The dwarf is resting too.':mode==='camera'?'Resuming. '+EX[exercise].pushed:'Demo continues.')};
$('manual').onclick=()=>swing();$('reset').onclick=()=>{if(role==='screen')link?.send({t:'cmd',c:'reset'});stopCamera();fresh();mode='idle';paused=false;wake?.release();sync();say('Ready for a new set. '+EX[exercise].again)};
$('full').onclick=async()=>{const el=$('arena');if(document.fullscreenElement){await document.exitFullscreen();return}if(el.classList.contains('fullscreen')){el.classList.remove('fullscreen');return}try{if(el.requestFullscreen)await el.requestFullscreen();else el.classList.add('fullscreen')}catch{el.classList.add('fullscreen')}};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!['idle','active'].includes(calibration.state))$('closeCalibration').onclick();$('arena').classList.remove('fullscreen')}});document.addEventListener('visibilitychange',()=>{if(document.hidden){calibration.interrupt();if(mode!=='idle'){paused=true;detector.reset();sync();say('Paused: the page was in the background. Tap Resume when you\'re back.')}}lastTime=performance.now()});window.addEventListener('pagehide',()=>{stopCamera();mode='idle';sync();wake?.release()});
// --- frame loop: one inference per presented video frame, never a queue ---
function startFrames(){stopFrames();tracker.resetStats();presentedBase=null;lastVideoTime=-1;scheduleFrame()}
function scheduleFrame(){const v=$('video');frameHandle='requestVideoFrameCallback'in v?{rvfc:v.requestVideoFrameCallback(onFrame)}:{raf:requestAnimationFrame(t=>onFrame(t,{}))}}
function stopFrames(){if(!frameHandle)return;const v=$('video');if(frameHandle.rvfc!==undefined)v.cancelVideoFrameCallback?.(frameHandle.rvfc);if(frameHandle.raf!==undefined)cancelAnimationFrame(frameHandle.raf);frameHandle=null}
function onFrame(now,meta){frameHandle=null;if(!stream)return;try{processFrame(now,meta)}catch(e){frameError(e)}if(stream&&!frameHandle)scheduleFrame()}
function wantFrames(){return !document.hidden&&tracker.ready&&!modelFailed&&(mode==='camera'?!paused:['positioning','countdown','checking','success','failed','interrupted'].includes(calibration.state))}
function processFrame(now,meta){
 const v=$('video');if(v.readyState<2||!v.videoWidth)return;
 if(!wantFrames()){clearOverlay();presentedBase=null;return}
 if(meta.presentedFrames===undefined&&v.currentTime===lastVideoTime)return;lastVideoTime=v.currentTime;
 if(meta.presentedFrames!==undefined&&presentedBase===null){presentedBase=meta.presentedFrames-1;tracker.resetStats()}
 const res=tracker.detect(v,now);frameErrors=0;
 const out=detector.update(res.landmarks,now,v.videoWidth/v.videoHeight);
 if(debugOn){debugFrame(now,res.landmarks,out);recFrame(now,res.landmarks,out)}onStatus(out.status,now);drawOverlay(res.landmarks,out,v);showStats(now,meta);
}
function frameError(e){console.warn('Pose inference failed',e);if(++frameErrors<5)return;modelFailed=true;stopFrames();clearOverlay();detector.reset();if(!['idle','active'].includes(calibration.state))calibration.set('modelError');else if(mode==='camera'){paused=true;sync();showHint('The pose model stopped. Tap "Camera again".')}}
function onStatus(status,now){
 lastStatus=status;statusFrames[status]=(statusFrames[status]||0)+1;
 if(status==='ok'){badSince=0;okSince||=now;if(!buttonReady&&now-okSince>250)buttonReady=true;if(now-rejectAt>3500)showHint('')}
 else{okSince=0;badSince||=now;if(now-badSince>400)showHint(HINTS[status]);if(buttonReady&&now-badSince>1000)buttonReady=false}
 if(calibration.state==='positioning')$('checkSwing').disabled=!buttonReady;
}
// --- diagnostics: live signal, thresholds and raw confidences, shown with ?debug or the checkbox ---
function debugFrame(now,lm,out){sigHistory.push({t:now,s:out.height,st:out.status});while(sigHistory.length&&now-sigHistory[0].t>8000)sigHistory.shift();if(now-lastDebug<100)return;lastDebug=now;const p=detector.params,w=i=>lm&&lm[i]?lm[i].visibility.toFixed(2)+'@y'+lm[i].y.toFixed(2):'-';
 $('debugText').textContent=['status: '+out.status+' · hands: '+out.hands+' · mode: '+detector.mode+' · phase: '+(detector.phase||'-'),'height (smoothed/raw): '+(out.height==null?'-':out.height.toFixed(2))+' / '+(out.raw==null?'-':out.raw.toFixed(2)),'wrist confidence L '+w(15)+' R '+w(16),'calibration: '+calibration.done+'/'+calibration.needed+' · last reject: '+lastReject,p?'top '+p.top.toFixed(2)+' bottom '+p.bottom.toFixed(2)+' enter threshold '+p.hi.toFixed(2)+' exit '+p.lo.toFixed(2):'calibration threshold: amplitude ≥ '+detector.o.minAmplitude+', cycle '+detector.o.minCycle+'-'+detector.o.maxCycle+' ms'].join('\n');
 const c=$('debugChart').getContext('2d'),W=360,H=120,y=v=>H-(v+.8)/2.4*H;c.clearRect(0,0,W,H);c.strokeStyle='#ffffff30';c.beginPath();c.moveTo(0,y(0));c.lineTo(W,y(0));c.stroke();
 if(p){for(const [v,col] of[[p.hi,'#71e5a3'],[p.lo,'#f67f82']]){c.strokeStyle=col;c.beginPath();c.moveTo(0,y(v));c.lineTo(W,y(v));c.stroke()}}
 c.strokeStyle='#f7d36d';c.lineWidth=2;let pen=false;c.beginPath();for(const f of sigHistory){const x=W-(now-f.t)/8000*W;if(f.s==null){pen=false;continue}if(pen)c.lineTo(x,y(f.s));else c.moveTo(x,y(f.s));pen=true}c.stroke();c.lineWidth=1}
// --- numbers-only session recording (no video, no images): landmarks of 8 body points per frame, for offline replay ---
const REC_POINTS=Object.values(POSE_POINTS),REC_MAX=12000;let rec={frames:[],events:[],full:false};
function recEvent(now,type,data){if(!debugOn)return;if(typeof now==='string'){data=type;type=now;now=performance.now()}rec.events.push({t:Math.round(now),type,...data})}
function recFrame(now,lm,out){if(rec.frames.length>=REC_MAX){rec.full=true;return}const r=n=>Math.round(n*1000)/1000;rec.frames.push({t:Math.round(now),c:calibration.state,m:mode,st:out.status,p:lm?REC_POINTS.map(i=>{const q=lm[i];return[r(q.x),r(q.y),r(q.visibility??1),q.presence===undefined?null:r(q.presence)]}):null});if(rec.frames.length%20===0)recInfo()}
function recInfo(){$('recInfo').textContent=rec.frames.length+' frames'+(rec.full?' (limit)':'')}
function recExport(){const v=$('video');return JSON.stringify({version:1,app:'kamnelom',created:new Date().toISOString(),userAgent:navigator.userAgent,delegate:modelDelegate,aspect:v.videoWidth&&v.videoHeight?v.videoWidth/v.videoHeight:4/3,video:[v.videoWidth,v.videoHeight],points:REC_POINTS,detectorOptions:detector.o,params:detector.params,inference:tracker.stats,note:'Body keypoint coordinates only; no video or images are recorded.',events:rec.events,frames:rec.frames})}
$('recSave').onclick=()=>{const url=URL.createObjectURL(new Blob([recExport()],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='kamnelom-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)};
$('recCopy').onclick=async()=>{try{await navigator.clipboard.writeText(recExport());$('recInfo').textContent='copied'}catch{$('recInfo').textContent='failed, use Download'}};
$('recClear').onclick=()=>{rec={frames:[],events:[],full:false};recInfo()};
function setDebug(on){debugOn=on;$('debugHud').hidden=!on;$('debugToggle').checked=on;sigHistory=[]}
$('debugToggle').onchange=()=>setDebug($('debugToggle').checked);setDebug(debugOn);
function showHint(text){if(text!==curHint){curHint=text;pushState()}for(const id of['gateHint','poseHint']){const e=$(id);if(e.textContent!==text)e.textContent=text;e.hidden=!text}}
function failHintNow(){let total=0,worst=null,n=0;for(const k in statusFrames){total+=statusFrames[k];if(k!=='ok'&&statusFrames[k]>n){worst=k;n=statusFrames[k]}}return worst&&n/total>.25?HINTS[worst]:rejectHint}
function renderProgress(done,needed){$('gateProgress').style.width=(done/needed*100)+'%';$('gateTitle').textContent='Swing '+done+' / '+needed;$('gateMessage').textContent=done<needed?'Counted. Bring the bell back to your chest and do the next one.':'All three swings detected.';showHint('');pushState()}
const overlay=$('overlay'),octx=overlay.getContext('2d'),NAMES=Object.fromEntries(Object.entries(POSE_POINTS).map(([k,v])=>[v,k])),BONES=[[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16]];
function clearOverlay(){octx.setTransform(1,0,0,1,0,0);octx.clearRect(0,0,overlay.width,overlay.height)}
// The canvas is mirrored by CSS exactly like the video, and landmarks are mapped through the same object-fit:contain box.
function drawPose(c,lm,out,w,h,vw,vh){
 c.clearRect(0,0,w,h);if(!lm||lm.length<25)return;const k=Math.min(w/vw,h/vh),rw=vw*k,rh=vh*k,ox=(w-rw)/2,oy=(h-rh)/2,P=i=>[ox+lm[i].x*rw,oy+lm[i].y*rh],good=i=>out.points?.[NAMES[i]]==='ok',ok=out.status==='ok';
 c.lineWidth=Math.max(2,w/160);c.lineCap='round';for(const [a,b] of BONES){c.strokeStyle=good(a)&&good(b)?(ok?'#71e5a3':'#f7d36d'):'#f6828188';c.beginPath();c.moveTo(...P(a));c.lineTo(...P(b));c.stroke()}
 for(const i of Object.keys(NAMES)){const [x,y]=P(Number(i));c.fillStyle=good(Number(i))?'#71e5a3':out.points?.[NAMES[i]]==='outside'?'#f67f82':'#f7d36d';c.beginPath();c.arc(x,y,Math.max(3,w/70),0,7);c.fill()}
}
function drawOverlay(lm,out,v){const w=overlay.clientWidth,h=overlay.clientHeight;if(!w||!h)return;const dpr=Math.min(window.devicePixelRatio||1,2);if(overlay.width!==Math.round(w*dpr)||overlay.height!==Math.round(h*dpr)){overlay.width=Math.round(w*dpr);overlay.height=Math.round(h*dpr)}octx.setTransform(dpr,0,0,dpr,0,0);drawPose(octx,lm,out,w,h,v.videoWidth,v.videoHeight)}
function showStats(now,meta){if(now-lastStats<500)return;lastStats=now;const st=tracker.stats,presented=meta.presentedFrames!==undefined&&presentedBase!==null?meta.presentedFrames-presentedBase:null;$('poseStats').textContent='MediaPipe Pose lite · '+modelDelegate+' · inference '+st.lastMs.toFixed(0)+' ms (avg '+st.avgMs.toFixed(0)+', peak '+st.maxMs.toFixed(0)+')\nframes processed: '+st.processed+(presented!==null?', skipped: '+Math.max(0,presented-st.processed):'')+(st.errors?', errors: '+st.errors:'')+' · status: '+lastStatus}
const hash=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x)};
function r(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),w,h)}
function poly(points,c){ctx.fillStyle=c;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(Math.round(x),Math.round(y)):ctx.moveTo(Math.round(x),Math.round(y)));ctx.closePath();ctx.fill()}
function crack(points,color='#302d3a',width=3){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke()}
function crystal(x,y,scale=1){ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);poly([[0,0],[-5,-15],[0,-29],[6,-17],[6,-2]],'#b67755');poly([[0,0],[0,-29],[6,-17],[6,-2]],'#f4ba72');poly([[-5,-2],[-12,-11],[-10,-20],[-4,-14]],'#d08c5d');r(0,-23,2,11,'#ffe1a1');ctx.restore()}
function rock(){if(hp<=0)return;let x=402,y=252;ctx.save();ctx.translate(x,y);r(-64,0,130,8,'#27232d');poly([[-75,-17],[-77,-57],[-61,-97],[-31,-119],[15,-128],[55,-107],[76,-68],[72,-24],[48,0],[-42,1]],'#53535e');poly([[-75,-57],[-60,-97],[-31,-119],[15,-128],[55,-107],[40,-85],[-14,-80],[-32,-37]],'#89818a');poly([[-32,-37],[-14,-80],[40,-85],[55,-107],[76,-68],[72,-24],[48,0],[-16,-1]],'#67636e');poly([[-60,-97],[-31,-119],[15,-128],[37,-114],[1,-110],[-27,-99]],'#b1a2a0');poly([[-75,-17],[-75,-57],[-32,-37],[-16,-1],[-42,1]],'#4a4855');poly([[40,-85],[76,-68],[72,-24],[48,0],[41,-36]],'#595460');r(-47,-86,15,4,'#a39699');r(-26,-103,8,3,'#c0aba1');r(40,-50,11,4,'#77717a');r(19,-24,7,4,'#827880');r(-58,-29,8,3,'#625c69');const damage=20-hp;
if(damage>0)crack([[-67,-59],[-49,-56],[-34,-65],[-20,-48]]);if(damage>3)crack([[-34,-65],[-30,-85],[-14,-96],[-9,-116]]);if(damage>6)crack([[-20,-48],[-3,-42],[8,-18],[5,-3]]);if(damage>9){crack([[-20,-48],[4,-61],[20,-53],[40,-69],[68,-66]]);crack([[4,-61],[-1,-80],[13,-88]],'#c49b77',1)}if(damage>12){crack([[20,-53],[22,-85],[39,-104]]);crack([[-49,-56],[-53,-30],[-41,-17],[-45,-2]]);crack([[8,-18],[34,-23],[49,-13]])}if(damage>16){crack([[-65,-59],[-49,-56],[-34,-65],[-20,-48],[4,-61],[20,-53],[40,-69]],'#e4a467',1);crack([[20,-53],[35,-35],[62,-32]]);r(-18,-48,3,5,'#ffd087')}ctx.restore()}
function dwarf(t){
 const phase=gameTime-hitAt,bob=mode==='idle'||paused?0:Math.sin(t*2)*.7;ctx.save();ctx.translate(278,Math.round(252+bob));
 drawGnome(ctx,screenLook||myLook,gnomePose(exercise,phase));ctx.restore()}
function impact(){pendingHit=false;const dmg=pendingDmg;hp=Math.max(0,hp-dmg);shake=hp===0?5+dmg:1.2+dmg*1.3;audio(dmg);let label=$('hitLabel');label.style.fontSize=hp===0?'':(14+dmg*5)+'px';label.textContent=hp===0?'BOULDER SMASHED!':'−'+dmg;label.classList.remove('pop');void label.offsetWidth;label.classList.add('pop');const num=hp===0?55:6+dmg*6;for(let i=0;i<num;i++){const seed=count*97+i;particles.push({x:hp===0?402+(hash(seed)-.5)*100:335,y:hp===0?190+hash(seed+11)*50:198,vx:(hash(seed+2)-.45)*(hp===0?150:95),vy:-30-hash(seed+3)*120,life:.5+hash(seed+4)*.7,size:2+Math.floor(hash(seed+5)*(hp===0?8:4)),color:['#b9a79b','#716977','#e8b16e','#d6c0a6'][i%4]})}if(hp===0){broken++;respawnAt=gameTime+.55}updateRock()}
function draw(t){ctx.save();if(shake>.05)ctx.translate(Math.round(Math.sin(t*99)*shake),Math.round(Math.cos(t*83)*shake*.6));r(-10,-10,660,380,'#282633');
// Layered mountain silhouettes and a deep mine entrance.
poly([[0,140],[45,80],[86,103],[131,41],[180,72],[230,24],[280,84],[340,48],[391,95],[449,35],[510,86],[565,46],[640,96],[640,280],[0,280]],'#36323f');poly([[0,187],[64,123],[112,145],[171,92],[219,136],[288,103],[352,147],[401,110],[477,136],[524,95],[586,129],[640,113],[640,280],[0,280]],'#403a48');
poly([[0,0],[77,0],[87,38],[66,66],[76,102],[43,127],[56,183],[28,218],[0,221]],'#51434c');poly([[640,0],[593,0],[575,30],[591,71],[571,105],[590,148],[578,192],[640,220]],'#4b3d46');
r(91,139,90,109,'#24232d');poly([[91,139],[110,115],[160,115],[181,139]],'#24232d');r(84,133,9,116,'#765239');r(176,133,9,116,'#765239');r(83,128,103,11,'#916445');r(87,131,94,3,'#ba8250');for(let i=0;i<4;i++){r(86,147+i*26,5,3,'#362d2e');r(177,147+i*26,5,3,'#362d2e')}r(104,148,63,5,'#46363a');r(106,153,5,92,'#46363a');r(160,153,5,92,'#46363a');
// Torch and amber light, no external graphics.
r(200,179,5,30,'#865a3e');r(196,179,13,5,'#3b3034');let flame=Math.floor(Math.sin(t*9)*2);poly([[195,175],[195,165],[200,155+flame],[202,165],[206,160-flame],[211,173],[206,180],[199,181]],'#d37f47');poly([[199,175],[201,164+flame],[206,173],[204,179]],'#ffd88a');r(212,171,3,3,'#9c6145');
// Ground strata, scattered rocks and rails.
r(0,256,640,104,'#554447');r(0,256,640,6,'#8a6550');r(0,262,640,5,'#6c5146');for(let i=0;i<60;i++){let x=hash(i)*640,y=274+hash(i+90)*85;r(x,y,3+Math.floor(hash(i+8)*12),2,['#75554a','#62494a','#443b42'][i%3])}for(let i=0;i<8;i++){r(84-i*14,269+i*9,96+i*3,5,'#5c4140')}crack([[118,245],[33,360]],'#9b8271',3);crack([[151,245],[128,360]],'#9b8271',3);crystal(527,256,.9);crystal(554,260,.6);crystal(58,255,.55);r(492,251,17,5,'#766976');r(507,254,10,3,'#91808a');r(355,264,12,4,'#a28c7d');r(458,260,18,5,'#7c6c75');
rock();dwarf(t);for(const p of particles)r(p.x,p.y,p.size,p.size,p.color);for(let i=0;i<10;i++){const x=hash(i+400)*640,y=(hash(i+500)*360+t*(1+hash(i)*2))%360;r(x,y,1,1,'#8d705b')}ctx.restore()}
function tick(t){const dt=Math.min((t-lastTime)/1000,.1);lastTime=t;if(!document.hidden){calibration.update(dt);if(calibration.state==='countdown')$('countdownDisplay').textContent=String(Math.max(1,Math.ceil(calibration.remaining)));}if(mode!=='idle'&&!paused){elapsed+=dt;gameTime+=dt;if(mode==='demo'&&elapsed-lastDemo>2){swing(t);lastDemo=elapsed}if(pendingHit&&gameTime-hitAt>=(GNOME_TIMING[exercise]||GNOME_TIMING.swing).hit)impact();if(gameTime>=respawnAt){hp=20;respawnAt=Infinity;updateRock()}for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=240*dt;p.life-=dt}particles=particles.filter(p=>p.life>0);shake*=Math.exp(-dt*12)}if(!window.stage3d)draw(gameTime);$('clock').textContent=String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(Math.floor(elapsed%60)).padStart(2,'0');strokes=strokes.filter(s=>elapsed-s<20);$('rate').textContent=strokes.length>=2?Math.round((strokes.length-1)*60/Math.max(1,strokes[strokes.length-1]-strokes[0])):'-';requestAnimationFrame(tick)}routeFromHash();sync();requestAnimationFrame(tick);

// --- phone + screen pairing (WebRTC data channel, no server; only counts, states and commands are sent) ---
const CAL_LABEL={idle:'WAITING FOR CAMERA',requesting:'STARTING CAMERA',loading:'LOADING MODEL',positioning:'GETTING IN FRAME',countdown:'COUNTDOWN',success:'READY!',failed:'FAILED / RETRY',interrupted:'INTERRUPTED',error:'CAMERA ERROR',modelError:'MODEL ERROR'};
function remoteLabel(){if(!link||!link.open)return role==='screen'&&remoteInfo?'PHONE LINK LOST':'WAITING FOR PHONE';if(performance.now()-remoteSeen>4000)return 'PHONE NOT RESPONDING';if(mode==='remote')return paused?'PAUSED':'PHONE · SWINGS';const i=remoteInfo;if(!i)return 'PHONE CONNECTED';return 'PHONE: '+(i.cal==='checking'?'PRACTICE '+i.done+'/'+i.needed:CAL_LABEL[i.cal]||'…')}
function applyExercise(){const e=EX[exercise];$('countLabel').textContent=e.unit;$('rateLabel').textContent=e.rate;$('startText').innerHTML=e.start+'<br>When the signal turns green, the dwarf starts.';$('rockHint').textContent=hp>0?e.rock:'The next boulder is waiting';for(const [id,k] of [['exSwing','swing'],['exSquat','squat'],['exPushup','pushup']])$(id).setAttribute('aria-selected',String(k===exercise))}
// Switching the exercise ends any running session; the counter logic and the gnome's tool change with it.
function setExercise(key,fromRemote){if(!EX[key]||key===exercise)return;exercise=key;if(!fromRemote&&(stream||mode!=='idle'||calibration.state!=='idle')){stopCamera();fresh();mode='idle';paused=false;wake?.release()}detector=makeDetector();applyExercise();sync()}
$('exSwing').onclick=()=>setExercise('swing');$('exSquat').onclick=()=>setExercise('squat');$('exPushup').onclick=()=>setExercise('pushup');
function pushState(){if(role!=='phone'||!link||!link.open)return;link.send({t:'state',cal:calibration.state,done:calibration.done,needed:calibration.needed,mode,paused,hint:curHint,status:lastStatus,n:count,ex:exercise,pid:profile.id})}
const PAIR_STEPS={screen:['Open this page on your phone: scan the QR code or send yourself the link.','The phone connects by itself, nothing to type.','On the phone, start the camera and do three practice reps.','The game plays on this screen while the phone counts reps.'],phone:['On the computer open this site and choose Screen.','Point the phone camera at the QR code on the computer or paste the link below.','Once connected, start the camera and train.','The game runs on the big screen; the phone only films and counts.']};
function setPair(kind,status,step=0){applyMode();$('pairPanel').hidden=false;$('pairTitle').textContent=kind==='screen'?'Screen for the phone':'Phone filming for the screen';$('pairStatus').textContent=status;$('pairSteps').innerHTML=PAIR_STEPS[kind].map((t,i)=>`<li class="${i<step?'done':i===step?'current':''}">${t}</li>`).join('');for(const id of['pairQr','pairCode','pairCopy','pairInput','pairScan','pairManual'])$(id).hidden=true}
function loadScript(src){return new Promise((ok,bad)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>bad(new Error('load'));document.head.appendChild(s)})}
const drawQr=text=>drawQrTo($('pairQr'),text);
async function drawQrTo(c,text){if(typeof qrcode==='undefined')await loadScript('vendor/qr/qrcode.js');const q=qrcode(0,'L');q.addData(text);q.make();const n=q.getModuleCount(),cell=Math.max(2,Math.floor(480/(n+8))),size=(n+8)*cell,x=c.getContext('2d');c.width=c.height=size;x.fillStyle='#fff';x.fillRect(0,0,size,size);x.fillStyle='#000';for(let r=0;r<n;r++)for(let k=0;k<n;k++)if(q.isDark(r,k))x.fillRect((k+4)*cell,(r+4)*cell,cell,cell);c.hidden=false}
function closeLink(){pairGeneration++;if(link){const l=link;link=null;l.close()}remoteInfo=null}
function leaveRemote(){screenLook=null;screenPid=null;closeLink();role='solo';$('pairPanel').hidden=true;stopScan();sync()}
function newLink(Kind=RemoteLink){closeLink();const generation=pairGeneration;link=new Kind({onOpen:()=>{if(generation===pairGeneration)onLinkOpen()},onClose:reason=>{if(generation===pairGeneration)onLinkClose(reason)},onMessage:m=>{if(generation===pairGeneration)onRemoteMessage(m)}});return link}
function onLinkOpen(){applyMode();stopScan();$('pairPanel').hidden=true;remoteSeen=performance.now();if(role==='screen'){if(screenFresh){screenFresh=false;stopCamera();fresh();mode='idle';paused=false}remoteInfo=null;sync();lock();say('Phone connected. Start its front camera: the phone counts and the game plays here.')}else{link.send({t:'hello',v:1});pushState();say('Connected to the screen. Start the front camera and pass the check: the game appears on the big screen.')}}
function onLinkClose(){if(!link||!link.persistent)link=null;applyMode();if(role==='screen'){if(mode==='remote')mode='idle';sync();say('Phone link lost. Tap Screen and reconnect: the score on screen is kept.')}else if(role==='phone')say('Screen link lost. The phone keeps counting; reconnect the screen if needed.')}
function syncCount(n){if(typeof n!=='number'||n===count)return;if(n===count+1)swing(performance.now());else if(n>=0){count=n;$('count').textContent=n}}
function onRemoteMessage(m){
 if(role==='screen'){
  if(m.t==='hello'||m.t==='state'||m.t==='swing')remoteSeen=performance.now();
  if(m.t==='swing')syncCount(m.n);
  else if(m.t==='state'){if(m.ex&&m.ex!==exercise)setExercise(m.ex,true);if(m.pid){screenLook=gnomeLook(m.pid);screenPid=m.pid}remoteInfo=m;const play=m.cal==='active'&&m.mode==='camera';if(play){if(mode!=='remote')mode='remote';paused=!!m.paused}else if(mode==='remote')mode='idle';syncCount(m.n);showHint(m.hint||'');sync();if(!play)say('Phone: '+(m.cal==='checking'?'practice swings '+m.done+' of '+m.needed:(CAL_LABEL[m.cal]||'…')).toLowerCase()+'.')}
 }else if(role==='phone'&&m.t==='cmd'){if(m.c==='pause'&&mode==='camera'&&!paused)$('pause').onclick();else if(m.c==='resume'&&paused)$('pause').onclick();else if(m.c==='reset')$('reset').onclick()}
}
setInterval(()=>{if(role==='phone')pushState();else if(role==='screen'&&link)sync()},1000);
async function startScreenManual(){
 role='screen';screenFresh=true;stopCamera();mode='idle';paused=false;fresh();sync();setPair('screen','Preparing the code…');
 try{const l=newLink(),generation=pairGeneration,code=await l.host();if(generation!==pairGeneration)return;const url=location.origin+location.pathname+'#join='+code;$('pairStatus').textContent='1. Scan the QR code with the iPhone camera and open the link in Safari. 2. The phone shows a reply code: paste it below or scan its QR with this computer\'s camera.';await drawQr(url);$('pairCode').value=url;$('pairCode').hidden=false;$('pairCopy').hidden=false;$('pairInput').hidden=false;$('pairScan').hidden=!navigator.mediaDevices?.getUserMedia;$('pairPaste').placeholder='Reply code from the phone'}
 catch(e){role='solo';closeLink();setPair('screen',e.message==='unsupported'?'This browser doesn\'t support WebRTC.':'Couldn\'t prepare the connection. Try again.')}
}
async function startPhone(offer){
 role='phone';setPair('phone','',1);
 if(!offer){$('pairStatus').textContent='Open the game on the big screen, choose Screen and paste the link or QR code here.';$('pairInput').hidden=false;$('pairScan').hidden=true;$('pairPaste').placeholder='Paste the link or code from the screen';return}
 $('pairStatus').textContent='Preparing the reply…';
 try{const l=newLink(),generation=pairGeneration,code=await l.accept(offer);if(generation!==pairGeneration)return;$('pairStatus').textContent='Show this QR to the computer\'s camera or copy the code and paste it on the screen. This panel closes once connected.';await drawQr('#answer='+code);$('pairCode').value=code;$('pairCode').hidden=false;$('pairCopy').hidden=false}
 catch(e){closeLink();$('pairStatus').textContent=e.message==='unsupported'?'This browser doesn\'t support WebRTC.':'The code didn\'t work or expired. Refresh the QR on the screen and retry.';$('pairInput').hidden=false}
}
$('pairManual').onclick=startScreenManual;$('modeScreen').onclick=startScreen;$('modePhone').onclick=()=>startPhone(null);$('modeLocal').onclick=()=>{if(role!=='solo'){leaveRemote();say('Playing on this device.')}};$('pairClose').onclick=()=>leaveRemote();
$('pairCopy').onclick=async()=>{try{await navigator.clipboard.writeText($('pairCode').value);$('pairStatus').textContent+=' Copied.'}catch{$('pairCode').select()}};
$('pairApply').onclick=async()=>{const text=$('pairPaste').value;if(!text.trim())return;try{const room=parseRoom(text);if(role==='phone'&&room)await joinRoom(room);else if(role==='screen'){await link.finish(text);$('pairStatus').textContent='Connecting…'}else{await startPhone(text)}}catch(e){$('pairStatus').textContent='The code didn\'t work. Make sure it was copied in full.'}};
let screenFresh=true;
const roomUrl=id=>location.origin+location.pathname+'#room='+id;
const roomError=e=>e&&e.code==='not-found'?'Screen not found: the link expired or the screen page is closed. Reopen the screen page and show a new QR.':e&&e.message==='unsupported'?'This browser doesn\'t support WebRTC.':'Couldn\'t reach the connection server (PeerJS). Check your internet or use manual pairing.';
async function startScreen(){
 role='screen';screenFresh=true;stopCamera();mode='idle';paused=false;fresh();sync();setPair('screen','Preparing the room…');
 try{if(typeof Peer==='undefined')await loadScript('vendor/peerjs/peerjs.min.js');const l=newLink(PeerLink),generation=pairGeneration,id=await l.host();if(generation!==pairGeneration)return;
  $('pairStatus').textContent='Scan the QR code with the iPhone camera and open the link in Safari: the phone connects by itself. The link works while this page is open.';await drawQr(roomUrl(id));$('pairCode').value=roomUrl(id);$('pairCode').hidden=false;$('pairCopy').hidden=false;$('pairManual').hidden=false}
 catch(e){role='solo';closeLink();setPair('screen',roomError(e));$('pairManual').hidden=false}
}
async function joinRoom(room){
 role='phone';setPair('phone','Connecting to the screen…',1);
 try{if(typeof Peer==='undefined')await loadScript('vendor/peerjs/peerjs.min.js');const l=newLink(PeerLink),generation=pairGeneration;await l.join(room);if(generation!==pairGeneration)return}
 catch(e){closeLink();$('pairStatus').textContent=roomError(e);$('pairInput').hidden=false;$('pairPaste').placeholder='Paste the link from the screen'}
}
let scanning=null;
function stopScan(){if(scanning){scanning.stop=true;scanning.stream.getTracks().forEach(t=>t.stop());scanning=null}$('scanVideo').hidden=true;$('scanVideo').srcObject=null}
$('pairScan').onclick=async()=>{if(scanning){stopScan();return}try{if(typeof jsQR==='undefined')await loadScript('vendor/qr/jsQR.js');const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'environment',width:{ideal:1280}}}),v=$('scanVideo'),c=document.createElement('canvas'),x=c.getContext('2d',{willReadFrequently:true}),state={stream,stop:false};scanning=state;v.srcObject=stream;v.hidden=false;await v.play();$('pairStatus').textContent='Show the phone\'s QR code to the camera.';
 const loop=()=>{if(state.stop)return;if(v.videoWidth){c.width=v.videoWidth;c.height=v.videoHeight;x.drawImage(v,0,0);const r=jsQR(x.getImageData(0,0,c.width,c.height).data,c.width,c.height);if(r&&r.data){$('pairPaste').value=r.data;stopScan();$('pairApply').onclick();return}}setTimeout(loop,120)};loop()}catch{stopScan();$('pairStatus').textContent='The scanning camera isn\'t available: paste the code manually.'}};
if(location.hash.startsWith('#join=')||location.hash.startsWith('#room=')){const h=location.hash;history.replaceState(null,'',location.pathname+location.search);const room=parseRoom(h);goView('play');if(room)joinRoom(room);else startPhone(h)}
// --- local check of a recorded video: stepped frame by frame at a fixed rate, so a run is reproducible and nothing is uploaded ---
const FILE_STEP=1/20;
function fileSeek(v,time){return new Promise((resolve,reject)=>{const done=()=>{v.onseeked=v.onerror=null;resolve()};v.onseeked=done;v.onerror=()=>{v.onseeked=v.onerror=null;reject(new Error('video'))};v.currentTime=time})}
async function checkVideoFile(file){
 const run=++fileRun,v=$('fileVideo'),cv=$('fileCanvas'),cc=cv.getContext('2d'),out=$('fileResult');
 stopCamera();mode='idle';paused=false;sync();wake?.release();
 $('fileCancel').hidden=false;cv.hidden=false;out.textContent='Loading the model…';
 const url=URL.createObjectURL(file),local=new PoseTracker({delegate:modelDelegate});
 try{
  await local.load();if(run!==fileRun)return;
  v.src=url;await new Promise((ok,bad)=>{v.onloadedmetadata=ok;v.onerror=()=>bad(new Error('video'))});if(run!==fileRun)return;
  const aspect=v.videoWidth/v.videoHeight;cv.height=Math.round(cv.width/aspect);
  const calSwings=[],swings=[],statuses={},rejects=[];let t0=0,calibratedAt=null;
  const det=new PoseSwingDetector({onSwing:t=>swings.push(t),onCalibration:(n,of,c)=>calSwings.push(t0),onReject:r=>rejects.push(r+' @'+(t0/1000).toFixed(1)+'s'),onCalibrated:()=>{calibratedAt=t0;det.startPlay()}});det.startCalibration();
  const total=Math.floor(v.duration/FILE_STEP);let frames=0,empty=0;
  for(let i=0;i<=total;i++){
   if(run!==fileRun){out.textContent+='\nStopped.';return}
   const time=Math.min(i*FILE_STEP,v.duration);await fileSeek(v,time);t0=Math.round(time*1000)+1;
   const res=local.detect(v,t0),r=det.update(res.landmarks,t0,aspect);frames++;if(!res.landmarks)empty++;statuses[r.status]=(statuses[r.status]||0)+1;
   cc.drawImage(v,0,0,cv.width,cv.height);drawPose(cc,res.landmarks,r,cv.width,cv.height,cv.width,cv.height);
   if(i%10===0)out.textContent='Processed '+(i+1)+' of '+(total+1)+' frames · swings in game: '+swings.length;
  }
  const f=t=>(t/1000).toFixed(1)+'s',st=local.stats;
  out.textContent=['File: '+file.name+' ('+v.duration.toFixed(1)+' s, '+v.videoWidth+'×'+v.videoHeight+'), step 1/20 s, frames: '+frames,
   calibratedAt===null?'Calibration: NOT finished ('+calSwings.length+' of 3 cycles'+(rejects.length?'; rejected: '+rejects.join(', '):'')+'). Counting never started.':'Calibration: 3 of 3 by '+f(calibratedAt)+' (these cycles don\'t count).',
   'Swings after calibration: '+swings.length+(swings.length?' · labels: '+swings.map(f).join(' '):''),
   'Frame statuses: '+Object.entries(statuses).map(([k,n])=>k+' '+n).join(', '),
   'Inference: avg '+st.avgMs.toFixed(0)+' ms, peak '+st.maxMs.toFixed(0)+' ms; no pose: '+empty,
   'This is not an accuracy score. Compare the labels with your own manual labelling of the same video.'].join('\n');
 }catch(e){if(run===fileRun)out.textContent='Couldn\'t check the video: '+(e.stage==='timeout'||e.stage?'the model didn\'t load ('+e.stage+').':'the file can\'t be opened in this browser.')}
 finally{URL.revokeObjectURL(url);v.removeAttribute('src');local.close();if(run===fileRun)$('fileCancel').hidden=true}
}
$('fileInput').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)checkVideoFile(f)};$('fileCancel').onclick=()=>{fileRun++;$('fileCancel').hidden=true};
