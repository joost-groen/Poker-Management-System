import { useEffect } from 'react';

/**
 * Your turn: a short vibration (where the device supports it), and a blinking tab title while the app is in
 * the background, until you are back or the turn is over.
 */
export function useTurnAlert(active: boolean, title: string) {
  useEffect(() => {
    if (!active) return;
    navigator.vibrate?.([40, 60, 40]);
    const original = document.title;
    let timer: ReturnType<typeof setInterval> | undefined;
    const blink = () => {
      clearInterval(timer);
      if (!document.hidden) {
        document.title = original;
        return;
      }
      let on = false;
      timer = setInterval(() => {
        on = !on;
        document.title = on ? `● ${title}` : original;
      }, 900);
    };
    blink();
    document.addEventListener('visibilitychange', blink);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', blink);
      document.title = original;
    };
  }, [active, title]);
}

/** Keeps the screen on while a game is open (phones would otherwise dim and lock mid-hand). */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const take = () => {
      if (document.hidden || stopped) return;
      navigator.wakeLock.request('screen').then((l) => {
        if (stopped) void l.release();
        else lock = l;
      }, () => {});
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', take);
      void lock?.release();
    };
  }, [on]);
}
