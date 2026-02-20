export type GameSpeed = "bullet" | "blitz" | "rapid" | "classical" | "custom";

export interface TimeControl {
  id: string;
  initial: number; 
  increment: number; 
  speed: GameSpeed;
}
