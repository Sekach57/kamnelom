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
if (typeof module !== 'undefined') module.exports = { RemoteLink, packSignal, unpackSignal };
