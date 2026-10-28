'use strict';
// In-memory stand-in for PeerJS: a registry plays the broker; connections are delivered asynchronously.
const defer = f => Promise.resolve().then(f);
function makeBroker() {
 const peers = new Map(); let n = 0;
 class Emitter { constructor() { this.l = {} } on(e, f) { (this.l[e] ||= []).push(f); return this } once(e, f) { const w = (...a) => { this.l[e] = this.l[e].filter(x => x !== w); f(...a) }; return this.on(e, w) } emit(e, ...a) { for (const f of [...(this.l[e] || [])]) f(...a) } }
 class Conn extends Emitter {
  constructor() { super(); this.open = false; this.other = null }
  send(m) { if (!this.open) throw new Error('not open'); const o = this.other, copy = JSON.parse(JSON.stringify(m)); defer(() => o.emit('data', copy)) }
  close() { if (!this.open) return; this.open = false; const o = this.other; defer(() => { this.emit('close'); if (o.open) { o.open = false; o.emit('close') } }) }
 }
 class Peer extends Emitter {
  constructor(id) {
   super(); this.id = id || 'anon-' + (++n); this.open = false; this.destroyed = false;
   defer(() => { if (peers.has(this.id)) return this.emit('error', { type: 'unavailable-id' }); if (Peer.down) return this.emit('error', { type: 'network' }); peers.set(this.id, this); this.open = true; this.emit('open', this.id) });
  }
  connect(id) {
   const a = new Conn(); defer(() => { const target = peers.get(id); if (!target) return this.emit('error', { type: 'peer-unavailable' }); const b = new Conn(); a.other = b; b.other = a; target.emit('connection', b); a.open = b.open = true; a.emit('open'); b.emit('open') }); return a;
  }
  reconnect() { } destroy() { this.destroyed = true; if (peers.get(this.id) === this) peers.delete(this.id) }
 }
 return { Peer, peers };
}
module.exports = { makeBroker };
