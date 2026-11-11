// Interface sounds in the spirit of Bencho's sound set: very short synthesized ticks and chimes (no audio files).
// Off by default; switched on in Settings. Nothing plays before the first user gesture (browsers block it anyway).
const KEY = 'r3d-sound';
let ctx = null;

export function soundOn() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
export function setSound(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
  if (on) play('ok');
}

function tone(f, d, { type = 'sine', gain = 0.04, at = 0, to = null } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + d + 0.03);
}

/** @param {'tap'|'toggle'|'open'|'ok'|'err'} kind */
export function play(kind) {
  if (!soundOn()) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    if (kind === 'tap') tone(2100, 0.028, { type: 'triangle', gain: 0.018 });
    else if (kind === 'toggle') tone(1300, 0.045, { type: 'triangle', gain: 0.026 });
    else if (kind === 'open') tone(520, 0.11, { gain: 0.028, to: 880 });
    else if (kind === 'ok') { tone(880, 0.1, { gain: 0.04 }); tone(1318, 0.16, { gain: 0.035, at: 0.07 }); }
    else if (kind === 'err') { tone(330, 0.15, { type: 'triangle', gain: 0.045 }); tone(247, 0.2, { type: 'triangle', gain: 0.04, at: 0.1 }); }
  } catch { /* no audio */ }
}

export function startSounds() {
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest?.('button:not(.hold), .side a, .tabbar a, a.hcard, .pal-row');
    if (!b || b.disabled) return;
    play(b.closest('.seg, .set-themes') ? 'toggle' : 'tap');
  }, { capture: true, passive: true });
}
