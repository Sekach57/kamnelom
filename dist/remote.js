'use strict';
// Phone + screen pairing over a WebRTC data channel, with no server: the offer and the answer are
// exchanged by hand (QR code or copy/paste). Only small JSON messages (swing counts, calibration
// state, hints, pause/reset commands) travel over the channel. No video, no images, no landmarks.
// Without a STUN server the link works between devices on the same local network.
const SIGNAL_VERSION = 1;
const toB64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
const fromB64 = text => { const s = atob(text.replace(/-/g, '+').replace(/_/g, '/')), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out };
async function pipe(bytes, stream) { const w = stream.writable.getWriter(); w.write(bytes).catch(() => { }); w.close().catch(() => { }); return new Uint8Array(await new Response(stream.readable).arrayBuffer()) }

// A signal code is "z" + deflate-raw(JSON) in base64url, or "p" + plain base64url when CompressionStream is missing.
async function packSignal(description) {
 const bytes = new TextEncoder().encode(JSON.stringify({ v: SIGNAL_VERSION, type: description.type, sdp: description.sdp }));
 if (typeof CompressionStream === 'undefined') return 'p' + toB64(bytes);
 return 'z' + toB64(await pipe(bytes, new CompressionStream('deflate-raw')));
}
async function unpackSignal(code) {
 const clean = String(code).trim().replace(/^.*#join=/, '').replace(/^.*#answer=/, '').replace(/\s+/g, '');
 if (!clean) throw new Error('empty');
 let bytes; try { bytes = fromB64(clean.slice(1)) } catch { throw new Error('bad code') }
 if (clean[0] === 'z') { if (typeof DecompressionStream === 'undefined') throw new Error('unsupported'); try { bytes = await pipe(bytes, new DecompressionStream('deflate-raw')) } catch { throw new Error('bad code') } } else if (clean[0] !== 'p') throw new Error('bad code');
 let d; try { d = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new Error('bad code') }
 if (d.v !== SIGNAL_VERSION || !['offer', 'answer'].includes(d.type) || typeof d.sdp !== 'string') throw new Error('bad code');
 return { type: d.type, sdp: d.sdp };
}
const gathered = (pc, ms) => new Promise(resolve => {
 if (pc.iceGatheringState === 'complete') return resolve();
 const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve() }, check = () => { if (pc.iceGatheringState === 'complete') done() }, timer = setTimeout(done, ms);
 pc.addEventListener('icegatheringstatechange', check);
});

class RemoteLink {
 // handlers: onOpen(), onClose(reason), onMessage(object). rtc: constructor for tests.
 constructor(handlers = {}, options = {}) { this.h = handlers; this.RTC = options.rtc || (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null); this.iceServers = options.iceServers || []; this.gatherMs = options.gatherMs ?? 3000; this.pc = null; this.ch = null; this.closed = false }
 get open() { return !!this.ch && this.ch.readyState === 'open' }
 make() {
  if (!this.RTC) throw new Error('unsupported');
  this.pc = new this.RTC({ iceServers: this.iceServers });
  this.pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(this.pc?.connectionState)) this.lost('connection ' + this.pc.connectionState) };
 }
 bind(ch) {
  this.ch = ch;
  ch.onopen = () => this.h.onOpen?.();
  ch.onclose = () => this.lost('channel closed');
  ch.onmessage = e => { let m; try { m = JSON.parse(e.data) } catch { return } if (m && typeof m === 'object' && typeof m.t === 'string') this.h.onMessage?.(m) };
 }
 lost(reason) { if (this.closed) return; this.closed = true; this.h.onClose?.(reason) }
 // Screen side: returns the offer code to show as a QR code.
 async host() { this.make(); this.bind(this.pc.createDataChannel('kamnelom', { ordered: true })); await this.pc.setLocalDescription(await this.pc.createOffer()); await gathered(this.pc, this.gatherMs); return packSignal(this.pc.localDescription) }
 // Phone side: takes the offer, returns the answer code.
 async accept(offerCode) {
  const offer = await unpackSignal(offerCode); if (offer.type !== 'offer') throw new Error('bad code');
  this.make(); this.pc.ondatachannel = e => this.bind(e.channel);
  await this.pc.setRemoteDescription(offer); await this.pc.setLocalDescription(await this.pc.createAnswer()); await gathered(this.pc, this.gatherMs);
  return packSignal(this.pc.localDescription);
 }
 // Screen side: takes the phone's answer.
 async finish(answerCode) { const a = await unpackSignal(answerCode); if (a.type !== 'answer') throw new Error('bad code'); await this.pc.setRemoteDescription(a) }
 send(message) { if (!this.open) return false; try { this.ch.send(JSON.stringify(message)); return true } catch { return false } }
 close() { this.closed = true; try { this.ch?.close() } catch { } try { this.pc?.close() } catch { } this.ch = this.pc = null }
}

// Room link: the screen registers a random, unguessable room id with a PeerJS broker (default public
// 0.peerjs.com), the phone opens "#room=<id>" and connects automatically. The broker only relays the
// connection setup (and STUN/TURN help); swing counts and states go straight between the devices.
// Same interface as RemoteLink (open, send, close, onOpen/onClose/onMessage). persistent = it reconnects by itself.
const ROOM_PREFIX = 'kamnelom-';
const newRoomId = () => { const a = new Uint8Array(10); (globalThis.crypto || require('crypto').webcrypto).getRandomValues(a); return ROOM_PREFIX + Array.from(a, b => (b % 36).toString(36)).join('') };
const parseRoom = text => { const m = /(?:room=|^\s*)(kamnelom-[a-z0-9]{10})\s*$/i.exec(String(text).trim()) || /room=(kamnelom-[a-z0-9]{10})/i.exec(String(text)); return m ? m[1].toLowerCase() : null };
class PeerLink {
 constructor(handlers = {}, options = {}) { this.h = handlers; this.Peer = options.Peer || (typeof Peer !== 'undefined' ? Peer : null); this.peerOptions = options.peerOptions || {}; this.timeoutMs = options.timeoutMs ?? 15000; this.retryMs = options.retryMs ?? 2000; this.maxRetries = options.maxRetries ?? 30; this.persistent = true; this.peer = null; this.conn = null; this.room = null; this.role = null; this.closed = false; this.retries = 0 }
 get open() { return !!this.conn && this.conn.open === true }
 wait(setup) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), this.timeoutMs); setup(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) }) }) }
 // Screen: registers the room and waits for one phone at a time.
 async host(room = newRoomId()) {
  if (!this.Peer) throw new Error('unsupported'); this.role = 'host'; this.room = room;
  await this.wait((ok, bad) => {
   this.peer = new this.Peer(room, this.peerOptions);
   this.peer.on('open', () => ok(room)); this.peer.on('error', e => { if (e.type === 'unavailable-id') bad(Object.assign(new Error('taken'), { code: 'taken' })); else if (!this.peer?.open) bad(e); else this.h.onError?.(e) });
   this.peer.on('disconnected', () => { if (!this.closed) { try { this.peer.reconnect() } catch { } } });
   this.peer.on('connection', c => this.adopt(c));
  });
  return room;
 }
 // A newer phone connection replaces a dead one, but never kicks a live one.
 adopt(c) {
  if (this.open) { try { c.on('open', () => c.close()) } catch { } return }
  this.conn = c; c.on('open', () => { if (this.conn === c) this.h.onOpen?.() }); c.on('data', m => this.message(m));
  c.on('close', () => { if (this.conn === c) { this.conn = null; this.h.onClose?.('closed') } }); c.on('error', () => { });
 }
 message(m) { if (m && typeof m === 'object' && typeof m.t === 'string') this.h.onMessage?.(m) }
 // Phone: joins the room; rejects with code 'not-found' | 'timeout' | 'taken' | Error.
 async join(room) {
  if (!this.Peer) throw new Error('unsupported'); this.role = 'guest'; this.room = room;
  await this.wait((ok, bad) => { this.peer = new this.Peer(undefined, this.peerOptions); this.peer.on('open', () => ok()); this.peer.on('error', e => bad(Object.assign(new Error(e.type || 'peer'), { code: e.type === 'peer-unavailable' ? 'not-found' : 'peer' }))) });
  this.peer.on('error', e => { if (e.type === 'peer-unavailable') this.retry() });
  this.peer.on('disconnected', () => { if (!this.closed) { try { this.peer.reconnect() } catch { } } });
  await this.connect(); return room;
 }
 connect() {
  return this.wait((ok, bad) => {
   const c = this.peer.connect(this.room, { reliable: true, serialization: 'json' }); let opened = false;
   this.peer.once?.('error', e => { if (!opened) bad(Object.assign(new Error(e.type || 'peer'), { code: e.type === 'peer-unavailable' ? 'not-found' : 'peer' })) });
   c.on('open', () => { opened = true; this.conn = c; this.retries = 0; this.h.onOpen?.(); ok() });
   c.on('data', m => this.message(m)); c.on('error', () => { });
   c.on('close', () => { if (this.conn === c) { this.conn = null; this.h.onClose?.('closed'); this.retry() } });
  });
 }
 retry() {
  if (this.closed || this.role !== 'guest' || this.timer) return;
  if (this.retries++ >= this.maxRetries) return;
  this.timer = setTimeout(() => { this.timer = null; if (!this.closed && !this.open) this.connect().catch(() => this.retry()) }, this.retryMs);
 }
 send(message) { if (!this.open) return false; try { this.conn.send(message); return true } catch { return false } }
 close() { this.closed = true; clearTimeout(this.timer); try { this.conn?.close() } catch { } try { this.peer?.destroy() } catch { } this.conn = this.peer = null }
}
if (typeof module !== 'undefined') module.exports = { RemoteLink, PeerLink, packSignal, unpackSignal, newRoomId, parseRoom };
