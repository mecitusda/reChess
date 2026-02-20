import type { MatchResult } from "./types";

export function mapReason(reason: MatchResult["reason"]): string {
  switch (reason) {
    case "checkmate":
      return "Checkmate";
    case "timeout":
      return "Time Out";
    case "resign":
      return "Resigned";
    case "draw_agreed":
      return "Draw Agreed";
    case "draw":
      return "Draw";
    case "aborted":
      return "Aborted";
    case "disconnect_timeout":
      return "Disconnect";
    default:
      return String(reason || "");
  }
}

