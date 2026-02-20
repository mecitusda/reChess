import { redis } from "../config/redis.js";
import { GameResult } from "../models/GameResult.js";

function userIdFromIdentity(identity) {
  const s = String(identity || "");
  return s.startsWith("user:") ? s.slice("user:".length) : "";
}

async function parseMoves(gameId) {
  try {
    const raw = await redis.lrange(`game:${gameId}:moves`, 0, -1);
    return raw
      .map((m) => {
        try {
          return JSON.parse(m);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}


export async function persistGameResultIfNeeded(game) {
  if (!game || game.state !== "FINISHED") return;

  const gameId = String(game.gameId || "");
  if (!gameId) return;

  const key = `game:${gameId}`;
  const already = await redis.hget(key, "_persisted");
  if (already === "1") return;

  const whiteUserId = userIdFromIdentity(game.whiteIdentity);
  const blackUserId = userIdFromIdentity(game.blackIdentity);
  const whiteIdentity = String(game.whiteIdentity || "");
  const blackIdentity = String(game.blackIdentity || "");

  const moves = await parseMoves(gameId);

  try {
    await GameResult.create({
      gameId,
      whiteSocketId: game.whiteId || "",
      blackSocketId: game.blackId || "",
      whiteIdentity,
      blackIdentity,
      whiteUserId,
      blackUserId,
      whiteName: game.whiteName || "",
      blackName: game.blackName || "",
      winner: game.winner,
      reason: game.finishReason,
      finalFen: game.fen,
      whiteTime: game.whiteTime,
      blackTime: game.blackTime,
      initialMs: game.initialMs || 0,
      incrementMs: game.incrementMs || 0,
      rated: !!game.rated,
      moves,
      pgn: game.pgn || "",
    });
  } catch (e) {
    if (!(e && typeof e === "object" && "code" in e && e.code === 11000)) {
      throw e;
    }
  } finally {
    await redis.hset(key, { _persisted: "1" });
  }
}

