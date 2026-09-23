/**
 * Procedural sound. No files: ceramic, glass and steel are three different
 * filter/decay recipes over the same noise burst, which is enough for the ear to
 * tell a mug from a saucepan.
 */
let ctx = null;
let master = null;
let noiseBuf = null;
let enabled = true;
let washNodes = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { enabled = false; return null; }
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const len = ctx.sampleRate * 0.5;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function resumeAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function setMuted(m) { enabled = !m; if (master) master.gain.value = m ? 0 : 0.5; }

const RECIPES = {
  porcelain: { f: 2400, q: 9, decay: 0.18, gain: 0.30, partials: [1, 2.7] },
  glass:     { f: 3900, q: 16, decay: 0.42, gain: 0.24, partials: [1, 2.4, 4.1] },
  steel:     { f: 1500, q: 7, decay: 0.55, gain: 0.26, partials: [1, 1.9, 3.3] },
  plastic:   { f: 900, q: 3, decay: 0.07, gain: 0.22, partials: [1] },
  wood:      { f: 620, q: 4, decay: 0.10, gain: 0.24, partials: [1, 1.6] },
};

/** One impact. `strength` 0..1 */
export function clink(kind = 'porcelain', strength = 0.5) {
  const c = ensure();
  if (!c || !enabled) return;
  const r = RECIPES[kind] ?? RECIPES.porcelain;
  const t = c.currentTime;
  const amp = Math.min(1, Math.max(0.05, strength));

  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = r.f * (0.9 + Math.random() * 0.2); bp.Q.value = r.q;
  const g = c.createGain();
  g.gain.setValueAtTime(r.gain * amp, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + r.decay);
  src.connect(bp).connect(g).connect(master);
  src.start(t); src.stop(t + r.decay + 0.02);

  // a couple of ringing partials give it a pitch
  r.partials.forEach((mult, i) => {
    const o = c.createOscillator();
    const og = c.createGain();
    o.type = 'sine';
    o.frequency.value = r.f * mult * (0.98 + Math.random() * 0.04);
    const gain = r.gain * amp * 0.35 / (i + 1);
    og.gain.setValueAtTime(gain, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + r.decay * (1 - i * 0.15));
    o.connect(og).connect(master);
    o.start(t); o.stop(t + r.decay + 0.02);
  });
}

export function ui(kind = 'tick') {
  const c = ensure();
  if (!c || !enabled) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(kind === 'up' ? 520 : 380, t);
  o.frequency.exponentialRampToValueAtTime(kind === 'up' ? 760 : 300, t + 0.06);
  g.gain.setValueAtTime(0.10, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.1);
}

/** The wash: filtered noise for water plus a low motor hum. */
export function startWash() {
  const c = ensure();
  if (!c || !enabled || washNodes) return;
  const t = c.currentTime;

  const src = c.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'bandpass'; lp.frequency.value = 1100; lp.Q.value = 0.7;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.11, t + 0.5);

  const osc = c.createOscillator();
  const og = c.createGain();
  osc.type = 'sawtooth'; osc.frequency.value = 62;
  const olp = c.createBiquadFilter();
  olp.type = 'lowpass'; olp.frequency.value = 220;
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.045, t + 0.5);

  src.connect(lp).connect(g).connect(master);
  osc.connect(olp).connect(og).connect(master);
  src.start(t); osc.start(t);
  washNodes = { src, osc, g, og };
}

export function stopWash() {
  if (!washNodes || !ctx) return;
  const t = ctx.currentTime;
  const { src, osc, g, og } = washNodes;
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  src.stop(t + 0.5); osc.stop(t + 0.5);
  washNodes = null;
}

export function fanfare(good = true) {
  const c = ensure();
  if (!c || !enabled) return;
  const t = c.currentTime;
  const notes = good ? [523, 659, 784, 1047] : [392, 330];
  notes.forEach((f, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    const st = t + i * 0.09;
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.12, st + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, st + 0.42);
    o.connect(g).connect(master);
    o.start(st); o.stop(st + 0.45);
  });
}

/** Map a dish to a sound recipe. */
export function kindForDish(def) {
  const m = def.geom?.material;
  const name = def.type;
  if (def.cutlery) return 'steel';
  if (name === 'wineGlass') return 'glass';
  if (!m) return 'steel';
  if (m.transmission !== undefined && m.opacity < 0.5) return m.color.getHex() === 0xeaf4ff ? 'plastic' : 'glass';
  const hex = m.color.getHex();
  if (hex === 0xb5834f) return 'wood';
  if (m.metalness > 0.4) return 'steel';
  if (m.clearcoat > 0) return 'porcelain';
  return 'plastic';
}
