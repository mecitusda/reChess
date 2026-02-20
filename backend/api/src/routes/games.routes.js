import express from "express";
import { verifyToken } from "../auth/jwt.js";
import { GameResult } from "../models/GameResult.js";

export const gamesRouter = express.Router();

function getBearerToken(req) {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m?.[1] ?? null;
}

function requireUserId(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: "NO_TOKEN" });
    return null;
  }
  try {
    const payload = verifyToken(token);
    const userId = String(payload?.userId || "");
    if (!userId) {
      res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
      return null;
    }
    return userId;
  } catch {
    res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
    return null;
  }
}

function resolveIdentity(req) {
  const token = getBearerToken(req);
  if (token) {
    try {
      const payload = verifyToken(token);
      const userId = String(payload?.userId || "");
      if (userId) return { userId, identity: `user:${userId}` };
    } catch {
    }
  }

  const guestId = String(req.headers["x-guest-id"] || "").trim();
  if (guestId) return { userId: null, identity: `guest:${guestId}` };

  return null;
}

gamesRouter.get("/me", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 20)));

  const games = await GameResult.find({
    $or: [{ whiteUserId: userId }, { blackUserId: userId }],
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const data = games.map((g) => ({
    gameId: g.gameId,
    createdAt: g.createdAt,
    winner: g.winner,
    reason: g.reason,
    whiteName: g.whiteName,
    blackName: g.blackName,
    whiteUserId: g.whiteUserId,
    blackUserId: g.blackUserId,
    initialMs: g.initialMs,
    incrementMs: g.incrementMs,
  }));

  res.json({ ok: true, data });
});

gamesRouter.get("/recent", async (req, res) => {
  const ident = resolveIdentity(req);
  if (!ident) return res.status(401).json({ ok: false, error: "NO_IDENTITY" });

  const limit = Math.max(1, Math.min(20, Number(req.query.limit || 5)));

  const q = ident.userId
    ? {
        $or: [
          { whiteUserId: ident.userId },
          { blackUserId: ident.userId },
          { whiteIdentity: ident.identity },
          { blackIdentity: ident.identity },
        ],
      }
    : { $or: [{ whiteIdentity: ident.identity }, { blackIdentity: ident.identity }] };

  const games = await GameResult.find(q).sort({ createdAt: -1 }).limit(limit).lean();

  function fmtTc(initialMs, incrementMs) {
    const m = Math.round(Number(initialMs || 0) / 60000);
    const inc = Math.round(Number(incrementMs || 0) / 1000);
    return `${m}+${inc}`;
  }

  const data = games.map((g) => {
    const myColor =
      (ident.userId && g.whiteUserId === ident.userId) || (g.whiteIdentity && g.whiteIdentity === ident.identity)
        ? "white"
        : (ident.userId && g.blackUserId === ident.userId) || (g.blackIdentity && g.blackIdentity === ident.identity)
          ? "black"
          : null;

    const myName = myColor === "white" ? g.whiteName : myColor === "black" ? g.blackName : g.whiteName;
    const oppName = myColor === "white" ? g.blackName : myColor === "black" ? g.whiteName : g.blackName;

    const winner = g.winner || null;

    const result =
      winner === "draw"
        ? "draw"
        : myColor && winner && winner === myColor
          ? "win"
          : myColor && winner && winner !== myColor
            ? "loss"
            : winner === "white"
              ? "win"
              : winner === "black"
                ? "loss"
                : "draw";

    const score =
      winner === "draw"
        ? "1/2-1/2"
        : myColor
          ? winner === myColor
            ? "1-0"
            : "0-1"
          : winner === "white"
            ? "1-0"
            : winner === "black"
              ? "0-1"
              : "-";

    return {
      id: g.gameId,
      opponent: `${myName} vs ${oppName}`,
      result,
      score,
      timeControl: fmtTc(g.initialMs, g.incrementMs),
      reason: g.reason,
      createdAt: g.createdAt,
    };
  });

  return res.json({ ok: true, data });
});

gamesRouter.get("/:gameId", async (req, res) => {
  const ident = resolveIdentity(req);
  if (!ident) return res.status(401).json({ ok: false, error: "NO_IDENTITY" });

  const gameId = String(req.params.gameId || "").trim();
  if (!gameId) return res.status(400).json({ ok: false, error: "BAD_GAME_ID" });

  const g = await GameResult.findOne({ gameId }).lean();
  if (!g) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

  const isParticipant =
    (ident.userId && (g.whiteUserId === ident.userId || g.blackUserId === ident.userId)) ||
    (ident.identity && (g.whiteIdentity === ident.identity || g.blackIdentity === ident.identity));
  if (!isParticipant) return res.status(403).json({ ok: false, error: "FORBIDDEN" });

  return res.json({
    ok: true,
    data: {
      gameId: g.gameId,
      createdAt: g.createdAt,
      winner: g.winner,
      reason: g.reason,
      whiteName: g.whiteName,
      blackName: g.blackName,
      initialMs: g.initialMs,
      incrementMs: g.incrementMs,
      whiteTime: g.whiteTime,
      blackTime: g.blackTime,
      finalFen: g.finalFen,
      moves: g.moves || [],
      pgn: g.pgn || "",
    },
  });
});
