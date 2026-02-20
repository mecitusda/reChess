/**
 * Oyun sesleri. public/sounds/ içindeki dosyalar:
 * - Move.mp3   : normal hamle
 * - Capture.mp3: taş alımı
 * - Check.mp3  : şah
 * - Checkmate.mp3: şah mat
 * - GenericNotify.mp3: bildirim (beraberlik teklifi, oyun bitti vb.)
 */

const SOUNDS = {
  move: "/sounds/Move.mp3",
  capture: "/sounds/Capture.mp3",
  check: "/sounds/Check.mp3",
  checkmate: "/sounds/Checkmate.mp3",
  notify: "/sounds/GenericNotify.mp3",
} as const;

const cache: Partial<Record<keyof typeof SOUNDS, HTMLAudioElement>> = {};

function getAudio(key: keyof typeof SOUNDS): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!cache[key]) {
    cache[key] = new Audio(SOUNDS[key]);
  }
  return cache[key] ?? null;
}

/** Tüm oyun seslerini önceden indirir; oyun başlamadan çağrılmalı. */
export function preloadGameSounds(): void {
  if (typeof window === "undefined") return;
  (Object.keys(SOUNDS) as (keyof typeof SOUNDS)[]).forEach((key) => {
    const audio = getAudio(key);
    if (audio) audio.load();
  });
}

function play(key: keyof typeof SOUNDS, volume = 0.5): void {
  try {
    const audio = getAudio(key);
    if (!audio) return;
    audio.currentTime = 0;
    audio.volume = volume;
    audio.play().catch(() => {});
  } catch {
    // ignore
  }
}

export function playMoveSound(): void {
  play("move");
}

export function playCaptureSound(): void {
  play("capture");
}

export function playCheckSound(): void {
  play("check");
}

export function playCheckmateSound(): void {
  play("checkmate");
}

export function playNotifySound(): void {
  play("notify");
}
