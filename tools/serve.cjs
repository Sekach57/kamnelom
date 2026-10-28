'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=fs.realpathSync(path.resolve(process.argv[2]||'dist')),port=Number(process.argv[3]||4173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.task':'application/octet-stream'};
http.createServer((req,res)=>{try{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const candidate=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
 const file=fs.realpathSync(candidate);
 if(!file.startsWith(root+path.sep)||!fs.statSync(file).isFile()){res.writeHead(403);res.end('Forbidden');return}
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
 if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
 }catch(e){res.writeHead(e.code==='ENOENT'?404:400);res.end('Not found or invalid request')}})
 .listen(port,'127.0.0.1',()=>console.log(`Serving ${root} at http://localhost:${port}`));
