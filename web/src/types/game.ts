export type PlayerColor = "white" | "black";

export interface MovePayload {
  gameId: string;
  from: string;
  to: string;
  promotion?: string;
}

export interface GameState {
  gameId: string;
  fen: string;
  turn: PlayerColor;
  status: "waiting" | "active" | "finished";
}
