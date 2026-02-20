/**
 * Hamle sesi. public/sounds/move.mp3 dosyasını eklemen yeterli.
 */

const MOVE_SOUND_PATH = "/sounds/move.wav";

let moveAudio: HTMLAudioElement | null = null;

function getMoveAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!moveAudio) {
    moveAudio = new Audio(MOVE_SOUND_PATH);
  }
  return moveAudio;
}

/** Hamle yapıldığında çalacak sesi oynatır. Ses dosyası yoksa sessizce yok sayar. */
export function playMoveSound(): void {
  try {
    const audio = getMoveAudio();
    if (!audio) return;
    audio.currentTime = 0;
    audio.volume = 0.5;
    audio.play().catch(() => {
      // Autoplay policy veya dosya yok
    });
  } catch {
    // ignore
  }
}
