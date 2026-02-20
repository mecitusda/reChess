import type { TimeControl } from "../types/time";

export const TIME_CONTROLS: TimeControl[] = [
  { id: "1+0", initial: 1, increment: 0, speed: "bullet" },
  { id: "2+1", initial: 2, increment: 1, speed: "bullet" },

  { id: "3+0", initial: 3, increment: 0, speed: "blitz" },
  { id: "3+2", initial: 3, increment: 2, speed: "blitz" },
  { id: "5+0", initial: 5, increment: 0, speed: "blitz" },
  { id: "5+3", initial: 5, increment: 3, speed: "blitz" },

  { id: "10+0", initial: 10, increment: 0, speed: "rapid" },
  { id: "10+5", initial: 10, increment: 5, speed: "rapid" },
  { id: "15+10", initial: 15, increment: 10, speed: "rapid" },

  { id: "30+0", initial: 30, increment: 0, speed: "classical" },
  { id: "30+20", initial: 30, increment: 20, speed: "classical" },
  { id: "custom", initial: 0, increment: 0, speed: "custom" },
];
