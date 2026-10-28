'use strict';
const $=id=>document.getElementById(id),canvas=$('world'),ctx=canvas.getContext('2d');
let mode='idle',paused=false,count=0,broken=0,hp=20,elapsed=0,strokes=[],lastSwing=-Infinity,lastDemo=0,stream=null,wake=null,lastTime=performance.now(),gameTime=0,hitAt=-10,pendingHit=false,respawnAt=Infinity,particles=[],shake=0,soundOn=false,audioContext=null,requestGeneration=0,frameHandle=null,modelFailed=false,hintSince=0,lastStatus='no_person',rejectHint='',rejectAt=-Infinity,statusFrames={},lastStats=0,presentedBase=null,fileRun=0,lastVideoTime=-1,frameErrors=0,okSince=0,badSince=0,buttonReady=false;
const modelDelegate=new URLSearchParams(location.search).get('delegate')==='gpu'?'GPU':'CPU';
const tracker=new PoseTracker({delegate:modelDelegate});
const calibration=new SwingCalibration(renderCalibration,startCameraGame,renderProgress);
// Trial swings only advance the calibration; in the game each full cycle is one hit.
const detector=new PoseSwingDetector({onSwing:t=>{if(mode==='camera'&&calibration.state==='active')swing(t)},onCalibration:n=>calibration.trial(n),onCalibrated:()=>calibration.accept(),onReject:reason=>{rejectHint=REJECT[reason]||'';rejectAt=performance.now();showHint(rejectHint)}});
const HINTS={no_person:'Не вижу тебя. Встань перед телефоном так, чтобы были видны плечи, руки и таз.',body_weak:'Плохо видно плечи или таз. Добавь света и отойди чуть дальше.',out_of_frame:'Часть тела вне кадра. Отойди дальше: нужны плечи, таз и нижняя точка свинга.',too_far:'Ты слишком далеко. Подойди ближе к телефону.',hands_lost:'Не вижу запястья. Руки с гирей должны быть видны, не закрывай их корпусом.',hands_outside:'Нижняя точка вне кадра: запястья уходят за край. Отойди дальше или подними телефон.',camera_moved:'Кадр изменился: телефон или ты сдвинулись. Вернись на место или нажми «Настроить камеру заново».'};
const REJECT={small:'Свинг слишком маленький: опускай гирю ниже и возвращай к груди.',fast:'Слишком быстро: делай ровные свинги вниз и обратно к груди.',slow:'Слишком медленно: сделай свинг без долгой паузы внизу.'};
function say(s){$('status').textContent=s}
function swing(t=performance.now()){if(mode==='idle'||paused||t-lastSwing<800||pendingHit)return;lastSwing=t;count++;strokes.push(elapsed);hitAt=gameTime;pendingHit=true;$('count').textContent=count}
function audio(){if(!soundOn||!audioContext)return;try{const a=audioContext,o=a.createOscillator(),g=a.createGain();o.type='triangle';o.frequency.setValueAtTime(150,a.currentTime);o.frequency.exponentialRampToValueAtTime(40,a.currentTime+.17);g.gain.setValueAtTime(.22,a.currentTime);g.gain.exponentialRampToValueAtTime(.001,a.currentTime+.22);o.connect(g);g.connect(a.destination);o.start();o.stop(a.currentTime+.23)}catch{}}
$('sound').onclick=async()=>{soundOn=!soundOn;if(soundOn){try{audioContext??=new(window.AudioContext||window.webkitAudioContext)();await audioContext.resume()}catch{soundOn=false;say('Звук недоступен в этом браузере. Игра продолжит работать.')}}$('sound').setAttribute('aria-pressed',String(soundOn));$('sound').textContent=soundOn?'♫ Звук включён':'♫ Звук выключен'};
async function lock(){try{if('wakeLock'in navigator)wake=await navigator.wakeLock.request('screen')}catch{}}
function renderCalibration(state){const panel=$('calibrationPanel');panel.dataset.state=state;const isOpen=!['idle','active'].includes(state);document.body.classList.toggle('calibrating',isOpen);document.querySelector('main').inert=isOpen;panel.hidden=state==='idle';panel.classList.toggle('compact',state==='active');$('checkSwing').hidden=!['positioning','failed','interrupted'].includes(state);$('retryCamera').hidden=state!=='error';$('retryModel').hidden=state!=='modelError';$('checkSwing').disabled=state==='positioning'&&!buttonReady;$('countdownDisplay').hidden=state!=='countdown';$('gateProgress').style.width=state==='success'?'100%':'0';
const copy={loading:['◉','ШАГ 1 / МОДЕЛЬ ПОЗЫ','Загружаем модель','Модель распознавания тела грузится на устройство. Это нужно один раз за открытие страницы.'],modelError:['!','МОДЕЛЬ НЕ ЗАГРУЗИЛАСЬ','Модель позы недоступна','Не удалось загрузить модель распознавания тела. Без неё счёт не работает: проверь соединение и повтори.'],requesting:['◉','ШАГ 1 / ФРОНТАЛЬНАЯ КАМЕРА','Включаем фронталку','Разреши доступ к камере. Ты увидишь себя на экране как в зеркале.'],positioning:['↕','ШАГ 1 / НАЙДИ СЕБЯ В КАДРЕ','Найди себя в кадре','Поставь телефон перед собой. Отойди, чтобы плечи, руки и таз были видны, а запястья не выходили за кадр в нижней точке. Кнопка включится, когда увижу тебя.'],countdown:['↕','ШАГ 2 / ПРИГОТОВЬСЯ','Начинаем через…','Телефон стоит неподвижно. Сейчас сделай три пробных свинга: вниз и обратно к груди.'],checking:['◉','ШАГ 2 / ПРОБНЫЕ СВИНГИ','Свинг 0 / 3','Сделай полный свинг вниз и обратно к груди. Пробные свинги в игру не идут.'],success:['✓','ШАГ 3 / ВСЁ ГОТОВО','Свинги 3 / 3','Отлично, три цикла замечены. Запускаю игру — следующий свинг станет ударом гнома.'],failed:['!','ПОКА НЕ УДАЛОСЬ РАСПОЗНАТЬ','Попробуем ещё раз',(failHintNow()||'Не увидел три полных цикла вниз и обратно. Отойди так, чтобы были видны плечи, руки и таз, и делай ровные свинги от груди до нижней точки.')+' Прогресс: '+calibration.done+' из '+calibration.needed+'.'],interrupted:['!','ПРОВЕРКА ПРЕРВАНА','Повторим пробные свинги','Страница была свёрнута. Убедись, что ты виден в кадре, и повтори проверку.'],error:['!','КАМЕРА НЕДОСТУПНА','Не получилось включить камеру','Открой сайт в Safari и разреши доступ к камере в настройках сайта.']};
if(copy[state]){const [icon,step,title,message]=copy[state];$('gateIcon').textContent=icon;$('gateStep').textContent=step;$('gateTitle').textContent=title;$('gateMessage').textContent=message}
$('checkSwing').textContent=state==='positioning'?'Я готов — три пробных свинга':'Попробовать снова';if(state==='checking'){detector.startCalibration();statusFrames={};rejectHint=''}else if(['positioning','countdown','failed','interrupted'].includes(state))detector.stop();if(state==='countdown')$('countdownDisplay').textContent='3';if(['positioning','failed','interrupted'].includes(state))$('checkSwing').focus();}
function startCameraGame(){if(!stream||!detector.params){calibration.set('error');return}mode='camera';paused=false;detector.startPlay();sync();lock();say('Три пробных свинга распознаны. Игра началась! Пробные свинги не учитываются.');$('pause').focus({preventScroll:true});$('arena').scrollIntoView({behavior:'smooth',block:'start'});}
function stopCamera(){requestGeneration++;stopFrames();clearOverlay();showHint('');if(stream)stream.getTracks().forEach(t=>{t.onended=null;t.onmute=null;t.stop()});stream=null;document.body.classList.remove('camera-active');$('video').srcObject=null;$('placeholder').style.display='flex';$('sensorDot').textContent='● ВЫКЛ';detector.stop();calibration.cancel();}
function sync(){ $('pause').disabled=mode==='idle';$('pause').textContent=paused?'Продолжить':'Пауза';$('manual').disabled=mode!=='demo'||paused;$('recalibrate').hidden=!stream;$('modeLabel').textContent=mode==='idle'?'СНАЧАЛА ПРОВЕРИМ СВИНГ':paused?'ПАУЗА':mode==='demo'?'ДЕМО · АВТОСВИНГИ':'КАМЕРА · СВИНГИ';$('demo').textContent=mode==='demo'?'Демо запущено':'Попробовать демо ↗';$('camera').textContent=stream?'◉ Проверить камеру заново':'◉ Включить фронталку';}
function updateRock(){ $('rocks').textContent=broken;$('hpText').textContent=hp+' / 20';$('health').style.width=(hp*5)+'%';$('rockTitle').textContent=hp>0?'ВАЛУН № '+String(broken+1).padStart(2,'0'):'КАМЕНЬ РАЗБИТ!';$('rockHint').textContent=hp>0?'Каждый свинг приближает раскол':'Следующий валун уже ждёт';}
function fresh(){count=0;broken=0;hp=20;elapsed=0;strokes=[];lastSwing=-Infinity;lastDemo=0;gameTime=0;hitAt=-10;pendingHit=false;particles=[];shake=0;respawnAt=Infinity;$('count').textContent='0';$('hitLabel').classList.remove('pop');detector.reset();updateRock()}
$('demo').onclick=()=>{stopCamera();fresh();mode='demo';paused=false;sync();lock();say('Демо: гном бьёт автоматически. Добавляй удары кнопкой «Удар вручную». 20 ударов разрушат валун.');};
async function loadModel(){if(tracker.ready){modelFailed=false;return true}try{await tracker.load();modelFailed=false;return true}catch(e){modelFailed=true;console.warn('Pose model failed to load',e.stage,e);return false}}
let modelLoad=null;const ensureModel=()=>modelLoad??=loadModel(); // a failed load is remembered until the user retries
// Camera is already on; make sure the model is loaded before the check. A failed model is never replaced by the old optical-flow detector.
async function enterCheck(generation){if(!tracker.ready){calibration.set('loading');say('Загружаем модель распознавания тела.');if(!await ensureModel()){if(generation===requestGeneration){calibration.set('modelError');say('Модель позы не загрузилась. Камера включена; повтори загрузку.')}return}if(generation!==requestGeneration)return}mode='idle';detector.stop();calibration.ready();sync();lock()}
async function openCamera(){
 if(stream){mode='idle';paused=false;detector.stop();sync();await enterCheck(requestGeneration);return}
 stopCamera();fresh();mode='idle';paused=false;sync();calibration.set('requesting');$('closeCalibration').focus();
 const generation=++requestGeneration;const b=$('camera');b.disabled=true;say('Настраиваем фронтальную камеру перед игрой.');if(modelFailed)modelLoad=null;ensureModel(); // model download runs while the permission prompt is open
 let incoming;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
  const base={width:{ideal:640},height:{ideal:480},frameRate:{ideal:20,max:24}};
  try{incoming=await navigator.mediaDevices.getUserMedia({audio:false,video:{...base,facingMode:{exact:'user'}}})}catch(e){if(e.name!=='OverconstrainedError')throw e;incoming=await navigator.mediaDevices.getUserMedia({audio:false,video:{...base,facingMode:{ideal:'user'}}})}
  if(generation!==requestGeneration){incoming.getTracks().forEach(t=>t.stop());return}
  stream=incoming;$('video').srcObject=stream;await $('video').play();if(generation!==requestGeneration)return;
  const track=stream.getVideoTracks()[0];
  track.onended=()=>{stopCamera();mode='idle';paused=false;sync();calibration.set('error');$('gateMessage').textContent='Камера отключилась. Подключи фронталку снова и повтори пробные свинги.'};
  track.onmute=()=>{if(['checking','countdown','success'].includes(calibration.state))calibration.interrupt();else if(mode==='camera'){paused=true;detector.reset();sync();say('Камера временно недоступна. Вернись в Safari и продолжи, когда появится изображение.')}};
  document.body.classList.add('camera-active');$('placeholder').style.display='none';$('sensorDot').textContent='● ФРОНТАЛКА';startFrames();await enterCheck(generation);
 }catch(e){if(generation!==requestGeneration)return;stopCamera();calibration.set('error');if(e.name==='NotFoundError')$('gateMessage').textContent='Камера не найдена. Открой эту страницу на iPhone в Safari.';else if(e.name!=='NotAllowedError')$('gateMessage').textContent='Не удалось запустить камеру. Проверь, не используется ли она другим приложением, и попробуй снова.'}finally{b.disabled=false}
}
$('retryModel').onclick=()=>{modelLoad=null;if(!stream){openCamera();return}enterCheck(requestGeneration)};$('camera').onclick=openCamera;$('retryCamera').onclick=openCamera;$('recalibrate').onclick=openCamera;$('checkSwing').onclick=()=>{if(!stream||!tracker.ready){calibration.set('error');return}detector.reset();calibration.begin();lock()};$('closeCalibration').onclick=()=>{stopCamera();mode='idle';paused=false;sync();wake?.release();say('Проверка отменена. Можно подключить фронталку снова.');$('camera').focus()};
$('pause').onclick=()=>{paused=!paused;detector.reset();sync();if(!paused)lock();else wake?.release();say(paused?'Пауза. Гном тоже отдыхает.':mode==='camera'?'Продолжаем. Один полный свинг — один удар.':'Демо продолжается.')};
$('manual').onclick=()=>swing();$('reset').onclick=()=>{stopCamera();fresh();mode='idle';paused=false;wake?.release();sync();say('Всё готово к новому подходу. Включи фронталку и попробуй один свинг.')};
$('full').onclick=async()=>{const el=$('arena');if(document.fullscreenElement){await document.exitFullscreen();return}if(el.classList.contains('fullscreen')){el.classList.remove('fullscreen');return}try{if(el.requestFullscreen)await el.requestFullscreen();else el.classList.add('fullscreen')}catch{el.classList.add('fullscreen')}};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!['idle','active'].includes(calibration.state))$('closeCalibration').onclick();$('arena').classList.remove('fullscreen')}});document.addEventListener('visibilitychange',()=>{if(document.hidden){calibration.interrupt();if(mode!=='idle'){paused=true;detector.reset();sync();say('Пауза: страница была свёрнута. Нажми «Продолжить», когда вернёшься.')}}lastTime=performance.now()});window.addEventListener('pagehide',()=>{stopCamera();mode='idle';sync();wake?.release()});
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
 onStatus(out.status,now);drawOverlay(res.landmarks,out,v);showStats(now,meta);
}
function frameError(e){console.warn('Pose inference failed',e);if(++frameErrors<5)return;modelFailed=true;stopFrames();clearOverlay();detector.reset();if(!['idle','active'].includes(calibration.state))calibration.set('modelError');else if(mode==='camera'){paused=true;sync();showHint('Модель позы остановилась. Нажми «Настроить камеру заново».')}}
function onStatus(status,now){
 lastStatus=status;statusFrames[status]=(statusFrames[status]||0)+1;
 if(status==='ok'){badSince=0;okSince||=now;if(!buttonReady&&now-okSince>250)buttonReady=true;if(now-rejectAt>3500)showHint('')}
 else{okSince=0;badSince||=now;if(now-badSince>400)showHint(HINTS[status]);if(buttonReady&&now-badSince>1000)buttonReady=false}
 if(calibration.state==='positioning')$('checkSwing').disabled=!buttonReady;
}
function showHint(text){for(const id of['gateHint','poseHint']){const e=$(id);if(e.textContent!==text)e.textContent=text;e.hidden=!text}}
function failHintNow(){let total=0,worst=null,n=0;for(const k in statusFrames){total+=statusFrames[k];if(k!=='ok'&&statusFrames[k]>n){worst=k;n=statusFrames[k]}}return worst&&n/total>.25?HINTS[worst]:rejectHint}
function renderProgress(done,needed){$('gateProgress').style.width=(done/needed*100)+'%';$('gateTitle').textContent='Свинг '+done+' / '+needed;$('gateMessage').textContent=done<needed?'Засчитан. Верни гирю к груди и сделай следующий.':'Все три свинга замечены.';showHint('')}
const overlay=$('overlay'),octx=overlay.getContext('2d'),NAMES=Object.fromEntries(Object.entries(POSE_POINTS).map(([k,v])=>[v,k])),BONES=[[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16]];
function clearOverlay(){octx.setTransform(1,0,0,1,0,0);octx.clearRect(0,0,overlay.width,overlay.height)}
// The canvas is mirrored by CSS exactly like the video, and landmarks are mapped through the same object-fit:contain box.
function drawPose(c,lm,out,w,h,vw,vh){
 c.clearRect(0,0,w,h);if(!lm||lm.length<25)return;const k=Math.min(w/vw,h/vh),rw=vw*k,rh=vh*k,ox=(w-rw)/2,oy=(h-rh)/2,P=i=>[ox+lm[i].x*rw,oy+lm[i].y*rh],good=i=>out.points?.[NAMES[i]]==='ok',ok=out.status==='ok';
 c.lineWidth=Math.max(2,w/160);c.lineCap='round';for(const [a,b] of BONES){c.strokeStyle=good(a)&&good(b)?(ok?'#71e5a3':'#f7d36d'):'#f6828188';c.beginPath();c.moveTo(...P(a));c.lineTo(...P(b));c.stroke()}
 for(const i of Object.keys(NAMES)){const [x,y]=P(Number(i));c.fillStyle=good(Number(i))?'#71e5a3':out.points?.[NAMES[i]]==='outside'?'#f67f82':'#f7d36d';c.beginPath();c.arc(x,y,Math.max(3,w/70),0,7);c.fill()}
}
function drawOverlay(lm,out,v){const w=overlay.clientWidth,h=overlay.clientHeight;if(!w||!h)return;const dpr=Math.min(window.devicePixelRatio||1,2);if(overlay.width!==Math.round(w*dpr)||overlay.height!==Math.round(h*dpr)){overlay.width=Math.round(w*dpr);overlay.height=Math.round(h*dpr)}octx.setTransform(dpr,0,0,dpr,0,0);drawPose(octx,lm,out,w,h,v.videoWidth,v.videoHeight)}
function showStats(now,meta){if(now-lastStats<500)return;lastStats=now;const st=tracker.stats,presented=meta.presentedFrames!==undefined&&presentedBase!==null?meta.presentedFrames-presentedBase:null;$('poseStats').textContent='MediaPipe Pose lite · '+modelDelegate+' · инференс '+st.lastMs.toFixed(0)+' мс (среднее '+st.avgMs.toFixed(0)+', пик '+st.maxMs.toFixed(0)+')\nобработано кадров: '+st.processed+(presented!==null?', пропущено: '+Math.max(0,presented-st.processed):'')+(st.errors?', ошибок: '+st.errors:'')+' · статус: '+lastStatus}
const hash=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x)};
function r(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),w,h)}
function poly(points,c){ctx.fillStyle=c;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(Math.round(x),Math.round(y)):ctx.moveTo(Math.round(x),Math.round(y)));ctx.closePath();ctx.fill()}
function crack(points,color='#302d3a',width=3){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke()}
function crystal(x,y,scale=1){ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);poly([[0,0],[-5,-15],[0,-29],[6,-17],[6,-2]],'#b67755');poly([[0,0],[0,-29],[6,-17],[6,-2]],'#f4ba72');poly([[-5,-2],[-12,-11],[-10,-20],[-4,-14]],'#d08c5d');r(0,-23,2,11,'#ffe1a1');ctx.restore()}
function rock(){if(hp<=0)return;let x=402,y=252;ctx.save();ctx.translate(x,y);r(-64,0,130,8,'#27232d');poly([[-75,-17],[-77,-57],[-61,-97],[-31,-119],[15,-128],[55,-107],[76,-68],[72,-24],[48,0],[-42,1]],'#53535e');poly([[-75,-57],[-60,-97],[-31,-119],[15,-128],[55,-107],[40,-85],[-14,-80],[-32,-37]],'#89818a');poly([[-32,-37],[-14,-80],[40,-85],[55,-107],[76,-68],[72,-24],[48,0],[-16,-1]],'#67636e');poly([[-60,-97],[-31,-119],[15,-128],[37,-114],[1,-110],[-27,-99]],'#b1a2a0');poly([[-75,-17],[-75,-57],[-32,-37],[-16,-1],[-42,1]],'#4a4855');poly([[40,-85],[76,-68],[72,-24],[48,0],[41,-36]],'#595460');r(-47,-86,15,4,'#a39699');r(-26,-103,8,3,'#c0aba1');r(40,-50,11,4,'#77717a');r(19,-24,7,4,'#827880');r(-58,-29,8,3,'#625c69');const damage=20-hp;
if(damage>0)crack([[-67,-59],[-49,-56],[-34,-65],[-20,-48]]);if(damage>3)crack([[-34,-65],[-30,-85],[-14,-96],[-9,-116]]);if(damage>6)crack([[-20,-48],[-3,-42],[8,-18],[5,-3]]);if(damage>9){crack([[-20,-48],[4,-61],[20,-53],[40,-69],[68,-66]]);crack([[4,-61],[-1,-80],[13,-88]],'#c49b77',1)}if(damage>12){crack([[20,-53],[22,-85],[39,-104]]);crack([[-49,-56],[-53,-30],[-41,-17],[-45,-2]]);crack([[8,-18],[34,-23],[49,-13]])}if(damage>16){crack([[-65,-59],[-49,-56],[-34,-65],[-20,-48],[4,-61],[20,-53],[40,-69]],'#e4a467',1);crack([[20,-53],[35,-35],[62,-32]]);r(-18,-48,3,5,'#ffd087')}ctx.restore()}
function dwarf(t){let phase=gameTime-hitAt,bob=mode==='idle'||paused?0:Math.sin(t*2)*.7;ctx.save();ctx.translate(278,Math.round(252+bob));
// Shadow, boots, apron and broad shoulders.
r(-28,2,59,5,'#25222b');r(-18,-14,13,17,'#402d2e');r(9,-14,14,17,'#402d2e');r(-22,-4,18,8,'#6c4434');r(8,-4,20,8,'#6c4434');r(-18,-40,40,29,'#9b5c38');r(-22,-42,47,14,'#c07b43');r(-12,-28,27,18,'#714a36');r(-19,-16,41,5,'#352c2e');r(-1,-18,8,8,'#d8a24e');r(1,-16,4,4,'#6b5032');r(-27,-40,10,20,'#72503c');r(-28,-27,11,10,'#d49a64');
// Face, nose, layered white beard and helmet.
r(-14,-67,31,25,'#d99c69');r(-9,-60,26,18,'#eab47b');r(15,-56,9,7,'#eab47b');r(11,-60,4,4,'#282a31');r(-13,-48,29,17,'#e3d9b7');r(-9,-32,22,10,'#e3d9b7');r(-5,-22,14,6,'#c9bc9c');r(-13,-48,7,17,'#b8ae99');r(-2,-45,4,17,'#f4e9c8');r(8,-45,4,14,'#f6e8c5');r(-18,-69,39,8,'#c38c41');r(-15,-82,31,14,'#d5a34e');r(-8,-88,18,7,'#e8b95f');r(-12,-79,5,9,'#f2ce79');r(-19,-68,42,4,'#6f593c');r(2,-76,9,9,'#5d5548');r(4,-74,5,5,'#ffe1a0');
// The hammer winds back, then strikes the left face of the boulder.
let angle=-.52;if(phase>=0&&phase<.2)angle=-.52-(phase/.2)*1.3;else if(phase<.29&&phase>=.2)angle=-1.82+((phase-.2)/.09)*1.67;else if(phase<.65&&phase>=.29)angle=-.15-(phase-.29)/.36*.37;
ctx.save();ctx.translate(18,-43);ctx.rotate(angle);r(0,-3,47,6,'#b27b43');r(5,-3,31,2,'#e3b069');r(3,-5,11,10,'#e8ab70');r(37,-15,19,28,'#46454f');r(35,-13,19,24,'#aaa2a2');r(35,-13,5,24,'#d1b9a3');r(40,-13,14,5,'#d5c5b3');r(40,6,14,5,'#726a75');ctx.restore();ctx.restore()}
function impact(){pendingHit=false;hp=Math.max(0,hp-1);shake=hp===0?5:2.5;audio();let label=$('hitLabel');label.textContent=hp===0?'КАМЕНЬ РАЗБИТ!':'−1';label.classList.remove('pop');void label.offsetWidth;label.classList.add('pop');const num=hp===0?55:14;for(let i=0;i<num;i++){const seed=count*97+i;particles.push({x:hp===0?402+(hash(seed)-.5)*100:335,y:hp===0?190+hash(seed+11)*50:198,vx:(hash(seed+2)-.45)*(hp===0?150:95),vy:-30-hash(seed+3)*120,life:.5+hash(seed+4)*.7,size:2+Math.floor(hash(seed+5)*(hp===0?8:4)),color:['#b9a79b','#716977','#e8b16e','#d6c0a6'][i%4]})}if(hp===0){broken++;respawnAt=gameTime+.55}updateRock()}
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
function tick(t){const dt=Math.min((t-lastTime)/1000,.1);lastTime=t;if(!document.hidden){calibration.update(dt);if(calibration.state==='countdown')$('countdownDisplay').textContent=String(Math.max(1,Math.ceil(calibration.remaining)));}if(mode!=='idle'&&!paused){elapsed+=dt;gameTime+=dt;if(mode==='demo'&&elapsed-lastDemo>2){swing(t);lastDemo=elapsed}if(pendingHit&&gameTime-hitAt>=.29)impact();if(gameTime>=respawnAt){hp=20;respawnAt=Infinity;updateRock()}for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=240*dt;p.life-=dt}particles=particles.filter(p=>p.life>0);shake*=Math.exp(-dt*12)}draw(gameTime);$('clock').textContent=String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(Math.floor(elapsed%60)).padStart(2,'0');strokes=strokes.filter(s=>elapsed-s<20);$('rate').textContent=strokes.length>=2?Math.round((strokes.length-1)*60/Math.max(1,strokes[strokes.length-1]-strokes[0])):'—';requestAnimationFrame(tick)}sync();requestAnimationFrame(tick);

// --- local check of a recorded video: stepped frame by frame at a fixed rate, so a run is reproducible and nothing is uploaded ---
const FILE_STEP=1/20;
function fileSeek(v,time){return new Promise((resolve,reject)=>{const done=()=>{v.onseeked=v.onerror=null;resolve()};v.onseeked=done;v.onerror=()=>{v.onseeked=v.onerror=null;reject(new Error('video'))};v.currentTime=time})}
async function checkVideoFile(file){
 const run=++fileRun,v=$('fileVideo'),cv=$('fileCanvas'),cc=cv.getContext('2d'),out=$('fileResult');
 stopCamera();mode='idle';paused=false;sync();wake?.release();
 $('fileCancel').hidden=false;cv.hidden=false;out.textContent='Загружаем модель…';
 const url=URL.createObjectURL(file),local=new PoseTracker({delegate:modelDelegate});
 try{
  await local.load();if(run!==fileRun)return;
  v.src=url;await new Promise((ok,bad)=>{v.onloadedmetadata=ok;v.onerror=()=>bad(new Error('video'))});if(run!==fileRun)return;
  const aspect=v.videoWidth/v.videoHeight;cv.height=Math.round(cv.width/aspect);
  const calSwings=[],swings=[],statuses={},rejects=[];let t0=0,calibratedAt=null;
  const det=new PoseSwingDetector({onSwing:t=>swings.push(t),onCalibration:(n,of,c)=>calSwings.push(t0),onReject:r=>rejects.push(r+' @'+(t0/1000).toFixed(1)+'с'),onCalibrated:()=>{calibratedAt=t0;det.startPlay()}});det.startCalibration();
  const total=Math.floor(v.duration/FILE_STEP);let frames=0,empty=0;
  for(let i=0;i<=total;i++){
   if(run!==fileRun){out.textContent+='\nОстановлено.';return}
   const time=Math.min(i*FILE_STEP,v.duration);await fileSeek(v,time);t0=Math.round(time*1000)+1;
   const res=local.detect(v,t0),r=det.update(res.landmarks,t0,aspect);frames++;if(!res.landmarks)empty++;statuses[r.status]=(statuses[r.status]||0)+1;
   cc.drawImage(v,0,0,cv.width,cv.height);drawPose(cc,res.landmarks,r,cv.width,cv.height,cv.width,cv.height);
   if(i%10===0)out.textContent='Обработано '+(i+1)+' из '+(total+1)+' кадров · свингов в игре: '+swings.length;
  }
  const f=t=>(t/1000).toFixed(1)+'с',st=local.stats;
  out.textContent=['Файл: '+file.name+' ('+v.duration.toFixed(1)+' с, '+v.videoWidth+'×'+v.videoHeight+'), шаг 1/20 с, кадров: '+frames,
   calibratedAt===null?'Калибровка: НЕ завершена ('+calSwings.length+' из 3 циклов'+(rejects.length?'; отклонено: '+rejects.join(', '):'')+'). Счёт не начинался.':'Калибровка: 3 из 3 к '+f(calibratedAt)+' (эти циклы не считаются).',
   'Свингов после калибровки: '+swings.length+(swings.length?' · метки: '+swings.map(f).join(' '):''),
   'Статусы кадров: '+Object.entries(statuses).map(([k,n])=>k+' '+n).join(', '),
   'Инференс: среднее '+st.avgMs.toFixed(0)+' мс, пик '+st.maxMs.toFixed(0)+' мс; без позы: '+empty,
   'Это не оценка точности. Сравни метки со своей ручной разметкой этого же видео.'].join('\n');
 }catch(e){if(run===fileRun)out.textContent='Не удалось проверить видео: '+(e.stage==='timeout'||e.stage?'модель не загрузилась ('+e.stage+').':'файл не открывается в этом браузере.')}
 finally{URL.revokeObjectURL(url);v.removeAttribute('src');local.close();if(run===fileRun)$('fileCancel').hidden=true}
}
$('fileInput').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)checkVideoFile(f)};$('fileCancel').onclick=()=>{fileRun++;$('fileCancel').hidden=true};
