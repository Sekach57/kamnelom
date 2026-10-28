'use strict';
class SwingCalibration {
 constructor(change,start){this.change=change;this.start=start;this.state='idle';this.remaining=0}
 set(state,seconds=0){this.state=state;this.remaining=seconds;this.change(state)}
 ready(){this.set('positioning')}
 begin(){if(['positioning','failed','interrupted'].includes(this.state))this.set('countdown',3)}
 accept(){if(this.state==='checking')this.set('success',1.6)}
 update(dt){if(!['countdown','checking','success'].includes(this.state))return;this.remaining-=dt;if(this.remaining>0)return;if(this.state==='countdown')this.set('checking',12);else if(this.state==='checking')this.set('failed');else {this.set('active');this.start()}}
 interrupt(){if(['countdown','checking','success'].includes(this.state))this.set('interrupted')}
 cancel(){this.set('idle')}
}
if(typeof module!=='undefined')module.exports={SwingCalibration};
