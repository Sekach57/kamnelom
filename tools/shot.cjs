'use strict';
// Screenshot of the running game plus a list of what GLTFLoader sees in each asset (clips, meshes, bones, morph targets).
//   node tools/shot.cjs [solo|build] [name]      -> tmp/shots/<name>.png
// Failed /api/ requests are expected here: the static server has no backend (profiles, leaderboard).
// Needs Playwright with Chromium; WebGL runs on SwiftShader, so it is slow but works without a GPU. Exit code 1 on page errors.
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const view=process.argv[2]||'solo',name=process.argv[3]||view,port=4199,out=path.resolve('tmp/shots');
const route={solo:'#/play',build:'#/build',party:'#/party'}[view]||'#/play';
(async()=>{
 const server=spawn(process.execPath,[path.join(__dirname,'serve.cjs'),'dist',String(port)],{stdio:'ignore'});
 await new Promise(r=>setTimeout(r,600));
 const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
 const problems=[],ignored=[];let code=0;
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.on('pageerror',e=>problems.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))problems.push('console.error: '+m.text());if(m.type()==='warning'&&/3D scene unavailable/.test(m.text()))problems.push(m.text())});
  page.on('response',r=>{if(r.status()>=400){const u=new URL(r.url()).pathname;(u.startsWith('/api/')?ignored:problems).push(r.status()+' '+u)}});
  await page.goto(`http://127.0.0.1:${port}/${route}`,{waitUntil:'load'});
  const ready=await page.evaluate(()=>window.Scene3D?window.Scene3D.ready:false).catch(()=>false);
  await page.waitForTimeout(view==='build'?4000:3000);
  const assets=await page.evaluate(async()=>{
   const {GLTFLoader}=await import("./vendor/three/GLTFLoader.js"),{MeshoptDecoder}=await import("./vendor/three/meshopt_decoder.module.js"),loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),res={};
   for(const f of ['dwarf','dwarf_moves','hammer','boulder']){
    try{const g=await new Promise((ok,bad)=>loader.load('assets/'+f+'.glb',ok,undefined,bad)),meshes=[],bones=[];
     g.scene.traverse(o=>{if(o.isMesh||o.isSkinnedMesh)meshes.push(o.name+(o.morphTargetDictionary?' morphs:'+Object.keys(o.morphTargetDictionary).join('/'):''));if(o.isBone)bones.push(o.name)});
     res[f]={clips:g.animations.map(a=>a.name+' '+a.duration.toFixed(2)+'s'),meshes,bones:bones.length}}
    catch(e){res[f]={error:String(e.message||e)}}}
   return res});
  fs.mkdirSync(out,{recursive:true});
  const file=path.join(out,name+'.png');await page.screenshot({path:file});
  console.log(JSON.stringify({view,screenshot:path.relative(process.cwd(),file),scene3dReady:ready,assets,problems,ignoredApiErrors:ignored.length},null,1));
  if(problems.length||ready!==true)code=1;
 }catch(e){console.error('shot failed:',e.message);code=1}
 finally{await browser.close();server.kill()}
 process.exit(code);
})();
