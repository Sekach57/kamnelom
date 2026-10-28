'use strict';
// Minimal in-memory stand-in for RTCPeerConnection/RTCDataChannel: connects an offerer and an answerer.
const registry = new Map(); let counter = 0;
class FakeChannel {
 constructor() { this.readyState = 'connecting'; this.peer = null }
 send(data) { if (this.readyState !== 'open') throw new Error('closed'); const p = this.peer; Promise.resolve().then(() => p.onmessage?.({ data })) }
 open() { this.readyState = 'open'; this.onopen?.() }
 close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.onclose?.(); const p = this.peer; if (p && p.readyState !== 'closed') p.close() }
}
class FakePC {
 constructor() { this.id = ++counter; registry.set(this.id, this); this.iceGatheringState = 'complete'; this.connectionState = 'new' }
 addEventListener() { } removeEventListener() { }
 createDataChannel() { this.local = new FakeChannel(); return this.local }
 async createOffer() { return { type: 'offer', sdp: 'fake-offer-' + this.id } }
 async createAnswer() { return { type: 'answer', sdp: 'fake-answer-' + this.id } }
 async setLocalDescription(d) { this.localDescription = d }
 async setRemoteDescription(d) {
  const other = registry.get(Number(d.sdp.split('-')[2])); if (!other) throw new Error('unknown peer');
  if (d.type === 'offer') { this.peer = other; return }
  // The answer arrived at the offerer: wire the two channels and open them.
  const remote = new FakeChannel(); this.local.peer = remote; remote.peer = this.local; other.ondatachannel?.({ channel: remote });
  Promise.resolve().then(() => { this.local.open(); remote.open() });
 }
 close() { this.local?.close() }
}
module.exports = { FakePC };
