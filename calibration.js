'use strict';
// Pre-game check: three trial swings with visible progress. Trial swings never reach the game counter.
class SwingCalibration {
 constructor(change, start, progress) { this.change = change; this.start = start; this.progress = progress; this.state = 'idle'; this.remaining = 0; this.needed = 3; this.done = 0 }
 set(state, seconds = 0) { this.state = state; this.remaining = seconds; this.change(state) }
 ready() { this.set('positioning') }
 begin() { if (['positioning', 'failed', 'interrupted'].includes(this.state)) { this.done = 0; this.set('countdown', 3) } }
 trial(done) { if (this.state !== 'checking') return; this.done = Math.min(done, this.needed); this.progress?.(this.done, this.needed) }
 accept() { if (this.state === 'checking' && this.done >= this.needed) this.set('success', 1.6) }
 update(dt) {
  if (!['countdown', 'checking', 'success'].includes(this.state)) return;
  this.remaining -= dt; if (this.remaining > 0) return;
  if (this.state === 'countdown') this.set('checking', 40); else if (this.state === 'checking') this.set('failed'); else { this.set('active'); this.start() }
 }
 interrupt() { if (['countdown', 'checking', 'success'].includes(this.state)) this.set('interrupted') }
 cancel() { this.set('idle') }
}
if (typeof module !== 'undefined') module.exports = { SwingCalibration };
