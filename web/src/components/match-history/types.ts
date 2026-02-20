export type MatchResult = {
  id: string;
  opponent: string;
  result: "win" | "loss" | "draw";
  score: string; 
  timeControl: string;
  reason: "checkmate" | "timeout" | "resign" | "draw_agreed" | "draw" | "aborted" | "disconnect_timeout" | string;
  createdAt: string;
};

