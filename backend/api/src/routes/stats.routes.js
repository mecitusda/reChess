import express from "express";
import { verifyToken } from "../auth/jwt.js";
import { GameResult } from "../models/GameResult.js";
import { redis } from "../config/redis.js";

export const statsRouter = express.Router();

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

function fmtTc(initialMs, incrementMs) {
  const m = Math.round(Number(initialMs || 0) / 60000);
  const inc = Math.round(Number(incrementMs || 0) / 1000);
  return `${m}+${inc}`;
}

function computeWld(games, userId) {
  let w = 0;
  let l = 0;
  let d = 0;
  for (const g of games) {
    if (g?.winner === "draw") {
      d += 1;
      continue;
    }
    const isWhite = g.whiteUserId === userId;
    const isBlack = g.blackUserId === userId;
    if (!isWhite && !isBlack) continue;
    const win =
      (g.winner === "white" && isWhite) ||
      (g.winner === "black" && isBlack);
    if (win) w += 1;
    else l += 1;
  }
  const total = w + l + d;
  const winRate = total ? Math.round((w / total) * 100) : 0;
  return { total, w, l, d, winRate };
}

function avg(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function dayKeyUtc(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isFinite(dt.getTime()) ? dt.toISOString().slice(0, 10) : "";
}

function buildLastNDaysSeries({ games, userId, days }) {
  const map = new Map();
  for (const k of days) map.set(k, { day: k, w: 0, l: 0, d: 0, total: 0 });

  for (const g of games) {
    const k = dayKeyUtc(g?.createdAt);
    if (!k || !map.has(k)) continue;

    const isWhite = g.whiteUserId === userId;
    const isBlack = g.blackUserId === userId;
    if (!isWhite && !isBlack) continue;

    const row = map.get(k);
    if (!row) continue;

    if (g.winner === "draw") {
      row.d += 1;
      row.total += 1;
      continue;
    }

    const win =
      (g.winner === "white" && isWhite) ||
      (g.winner === "black" && isBlack);
    if (win) row.w += 1;
    else row.l += 1;
    row.total += 1;
  }

  return days.map((k) => map.get(k));
}

statsRouter.get("/me", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const cacheKey = `stats:me:${userId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      try {
        return res.json(JSON.parse(cached));
      } catch {
      }
    }

    const now = Date.now();
    const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const games = await GameResult.find({
      $or: [{ whiteUserId: userId }, { blackUserId: userId }],
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .select({
        winner: 1,
        whiteUserId: 1,
        blackUserId: 1,
        initialMs: 1,
        incrementMs: 1,
        createdAt: 1,
        updatedAt: 1,
        moves: 1,
      })
      .lean();

    const allTime = computeWld(games, userId);
    const last7Games = games.filter((g) => g?.createdAt && new Date(g.createdAt) >= d7);
    const last30Games = games.filter((g) => g?.createdAt && new Date(g.createdAt) >= d30);

    const last7 = computeWld(last7Games, userId);
    const last30 = computeWld(last30Games, userId);

    const tcCounts = new Map();
    for (const g of last30Games) {
      const tc = fmtTc(g.initialMs, g.incrementMs);
      tcCounts.set(tc, (tcCounts.get(tc) || 0) + 1);
    }
    let topTc = null;
    let topTcCount = 0;
    for (const [k, v] of tcCounts.entries()) {
      if (v > topTcCount) {
        topTc = k;
        topTcCount = v;
      }
    }

    const tcDist = Array.from(tcCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([timeControl, count]) => ({ timeControl, count }));

    const durationsSec = [];
    const moveCounts = [];
    for (const g of last30Games) {
      const movesLen = Array.isArray(g.moves) ? g.moves.length : 0;
      if (movesLen) moveCounts.push(movesLen);

      const createdAt = g.createdAt ? new Date(g.createdAt).getTime() : 0;
      const updatedAt = g.updatedAt ? new Date(g.updatedAt).getTime() : 0;
      if (createdAt && updatedAt && updatedAt >= createdAt) {
        durationsSec.push((updatedAt - createdAt) / 1000);
      }
    }

    const days = [];
    for (let i = 29; i >= 0; i -= 1) {
      const dt = new Date(now - i * 24 * 60 * 60 * 1000);
      days.push(dayKeyUtc(dt));
    }
    const last30Daily = buildLastNDaysSeries({ games: last30Games, userId, days });

    const data = {
      ok: true,
      data: {
        allTime,
        last7,
        last30,
        mostPlayed: topTc ? { timeControl: topTc, count: topTcCount } : null,
        tcDist,
        last30Daily,
        avgDurationSec: Math.round(avg(durationsSec)),
        avgMoves: Math.round(avg(moveCounts)),
      },
    };

    await redis.set(cacheKey, JSON.stringify(data), "EX", 30);
    return res.json(data);
  } catch (e) {
    console.error("[stats/me] error", e);
    return res.status(500).json({ ok: false, error: "INTERNAL" });
  }
});

