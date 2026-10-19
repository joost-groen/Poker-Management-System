import { useSyncExternalStore } from 'react';
import type { HandView } from '../../../shared/poker/view.ts';

// Table sounds, synthesised with Web Audio: no files to load, and they work offline in the installed app.

export type Sound = 'deal' | 'card' | 'flop' | 'check' | 'chips' | 'allIn' | 'fold' | 'turn' | 'win' | 'pot' | 'message';

const KEY = 'poker-online-sound';
const listeners = new Set<() => void>();
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(KEY, value ? 'off' : 'on');
  } catch {
    /* the setting just won't stick */
  }
  for (const l of listeners) l();
  if (!value) play('chips');
}

export function isMuted(): boolean {
  return muted;
}

export function useMuted(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => muted,
  );
}

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!ctx) {
    ctx = new AudioContext();
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// Browsers only start audio after a tap; the first one anywhere unlocks it.
if (typeof window !== 'undefined') {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** A burst of filtered noise: card flicks, chip clicks, swishes. */
function burst(c: AudioContext, at: number, o: { freq: number; q?: number; gain: number; len: number; type?: BiquadFilterType; sweep?: number }) {
  const src = c.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filter = c.createBiquadFilter();
  filter.type = o.type ?? 'bandpass';
  filter.frequency.setValueAtTime(o.freq, at);
  if (o.sweep) filter.frequency.exponentialRampToValueAtTime(o.sweep, at + o.len);
  filter.Q.value = o.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(o.gain, at + Math.min(0.006, o.len / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.len);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(at, Math.random() * 0.5, o.len + 0.05);
}

function tone(c: AudioContext, at: number, o: { freq: number; gain: number; len: number; type?: OscillatorType; to?: number }) {
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, at);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + o.len);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(o.gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.len);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + o.len + 0.05);
}

const card = (c: AudioContext, at: number) => burst(c, at, { freq: 2600, q: 0.8, gain: 0.22, len: 0.07, sweep: 1200 });

function chips(c: AudioContext, at: number, n: number) {
  let t = at;
  for (let k = 0; k < n; k++) {
    burst(c, t, { freq: 4200 + Math.random() * 2400, q: 6, gain: 0.25, len: 0.035 });
    tone(c, t, { freq: 3000 + Math.random() * 1800, gain: 0.05, len: 0.04 });
    t += 0.03 + Math.random() * 0.045;
  }
}

export function play(sound: Sound) {
  if (muted) return;
  const c = audio();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime + 0.01;
  switch (sound) {
    case 'deal':
      for (let k = 0; k < 4; k++) card(c, now + k * 0.085);
      break;
    case 'card':
      card(c, now);
      break;
    case 'flop':
      for (let k = 0; k < 3; k++) card(c, now + k * 0.11);
      break;
    case 'check':
      for (let k = 0; k < 2; k++) {
        tone(c, now + k * 0.11, { freq: 170, to: 90, gain: 0.35, len: 0.09 });
        burst(c, now + k * 0.11, { freq: 600, type: 'lowpass', gain: 0.2, len: 0.05 });
      }
      break;
    case 'chips':
      chips(c, now, 3 + Math.floor(Math.random() * 3));
      break;
    case 'allIn':
      tone(c, now, { freq: 110, to: 55, gain: 0.3, len: 0.3 });
      chips(c, now + 0.04, 9);
      break;
    case 'fold':
      burst(c, now, { freq: 900, sweep: 2600, q: 0.7, gain: 0.12, len: 0.2 });
      break;
    case 'turn':
      tone(c, now, { freq: 880, gain: 0.12, len: 0.22 });
      tone(c, now + 0.1, { freq: 1320, gain: 0.1, len: 0.3 });
      break;
    case 'pot':
      chips(c, now, 7);
      break;
    case 'message':
      tone(c, now, { freq: 1250, to: 1600, gain: 0.06, len: 0.12 });
      break;
    case 'win':
      chips(c, now, 6);
      [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => tone(c, now + 0.12 + k * 0.09, { freq: f, gain: 0.12, len: 0.35, type: 'triangle' }));
      break;
  }
}

/** The sounds for one step on screen, from what changed between two frames. `me`: the viewer's id. */
export function soundsFor(prev: HandView | null, next: HandView | null, me: string | null) {
  if (!next) return;
  if (!prev || prev.handNo !== next.handNo) {
    if (!next.result) play('deal');
    if (next.legal) setTimeout(() => play('turn'), 450);
    return;
  }
  for (const a of next.actions.slice(prev.actions.length)) {
    if (a.type === 'fold') play('fold');
    else if (a.type === 'check') play('check');
    else if (a.allIn) play('allIn');
    else if (a.type === 'call' || a.type === 'raise') play('chips');
  }
  const dealt = next.board.length - prev.board.length;
  if (dealt === 3) play('flop');
  else if (dealt > 0) play('card');
  if (next.result && !prev.result) {
    const won = me !== null && (next.result.net[me] ?? 0) > 0;
    play(won ? 'win' : 'pot');
  }
  if (next.legal && !prev.legal) play('turn');
}
