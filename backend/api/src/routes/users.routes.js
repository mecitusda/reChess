import express from "express";
import { User } from "../models/User.js";
import { GameResult } from "../models/GameResult.js";
import { UserRating } from "../models/UserRating.js";
import { redis } from "../config/redis.js";

export const usersRouter = express.Router();

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
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
    const win = (g.winner === "white" && isWhite) || (g.winner === "black" && isBlack);
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

    const win = (g.winner === "white" && isWhite) || (g.winner === "black" && isBlack);
    if (win) row.w += 1;
    else row.l += 1;
    row.total += 1;
  }

  return days.map((k) => map.get(k));
}


usersRouter.get("/:username/presence", async (req, res) => {
  const username = normalizeUsername(req.params.username);
  if (!username) return res.status(400).json({ ok: false, error: "BAD_USERNAME" });
  try {
    const user = await User.findOne({ username }).select({ _id: 1 }).lean();
    if (!user?._id) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    const uid = String(user._id);
    const online = (await redis.get(`presence:user:${uid}`)) === "1";
    const lastActiveRaw = await redis.get(`presence:user:${uid}:lastActive`);
    const lastActiveAt = lastActiveRaw ? parseInt(lastActiveRaw, 10) : null;
    return res.json({ ok: true, online: !!online, lastActiveAt });
  } catch (e) {
    console.error("[users/presence] error", username, e);
    return res.status(500).json({ ok: false, error: "INTERNAL" });
  }
});

usersRouter.get("/:username", async (req, res) => {
  const username = normalizeUsername(req.params.username);
  if (!username) return res.status(400).json({ ok: false, error: "BAD_USERNAME" });

  const cacheKey = `profile:u:${username}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const uid = parsed?.data?.user?.id ?? (await User.findOne({ username }).select({ _id: 1 }).lean())?._id;
        if (uid) {
          const sid = String(uid);
          const online = (await redis.get(`presence:user:${sid}`)) === "1";
          const lastActiveRaw = await redis.get(`presence:user:${sid}:lastActive`);
          const lastActiveAt = lastActiveRaw ? parseInt(lastActiveRaw, 10) : null;
          if (parsed.data?.user) {
            parsed.data.user.online = !!online;
            parsed.data.user.lastActiveAt = lastActiveAt;
          }
        }
        return res.json(parsed);
      } catch {
      }
    }

    const user = await User.findOne({ username }).select({ username: 1, createdAt: 1, country: 1 }).lean();
    if (!user?._id) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    const userId = String(user._id);

    const ratingsDocs = await UserRating.find({ userId }).lean();
    const ratings = { bullet: null, blitz: null, rapid: null, classical: null };
    for (const r of ratingsDocs) {
      if (!r?.speed) continue;
      if (r.speed === "bullet") ratings.bullet = r;
      if (r.speed === "blitz") ratings.blitz = r;
      if (r.speed === "rapid") ratings.rapid = r;
      if (r.speed === "classical") ratings.classical = r;
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
        gameId: 1,
        winner: 1,
        reason: 1,
        whiteUserId: 1,
        blackUserId: 1,
        whiteName: 1,
        blackName: 1,
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
    const tcDist = Array.from(tcCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([timeControl, count]) => ({ timeControl, count }));
    const mostPlayed = tcDist.length ? { timeControl: tcDist[0].timeControl, count: tcDist[0].count } : null;

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

    const recentGames = games.slice(0, 12).map((g) => {
      const isWhite = g.whiteUserId === userId;
      const myColor = isWhite ? "white" : "black";
      const oppName = isWhite ? g.blackName : g.whiteName;
      const winner = g.winner || null;
      const result =
        winner === "draw"
          ? "draw"
          : winner === myColor
            ? "win"
            : "loss";
      return {
        gameId: g.gameId,
        createdAt: g.createdAt,
        timeControl: fmtTc(g.initialMs, g.incrementMs),
        opponentName: oppName,
        result,
        reason: g.reason,
      };
    });

    const online = (await redis.get(`presence:user:${userId}`)) === "1";
    const lastActiveRaw = await redis.get(`presence:user:${userId}:lastActive`);
    const lastActiveAt = lastActiveRaw ? parseInt(lastActiveRaw, 10) : null;

    const payload = {
      ok: true,
      data: {
        user: {
          id: userId,
          username: user.username,
          joinedAt: user.createdAt,
          country: user.country,
          online: !!online,
          lastActiveAt,
        },
        ratings: {
          bullet: ratings.bullet
            ? { rating: ratings.bullet.rating, rd: ratings.bullet.rd, provisional: ratings.bullet.provisional, games: ratings.bullet.games }
            : null,
          blitz: ratings.blitz
            ? { rating: ratings.blitz.rating, rd: ratings.blitz.rd, provisional: ratings.blitz.provisional, games: ratings.blitz.games }
            : null,
          rapid: ratings.rapid
            ? { rating: ratings.rapid.rating, rd: ratings.rapid.rd, provisional: ratings.rapid.provisional, games: ratings.rapid.games }
            : null,
          classical: ratings.classical
            ? { rating: ratings.classical.rating, rd: ratings.classical.rd, provisional: ratings.classical.provisional, games: ratings.classical.games }
            : null,
        },
        stats: {
          allTime,
          last7,
          last30,
          mostPlayed,
          tcDist,
          last30Daily,
          avgDurationSec: Math.round(avg(durationsSec)),
          avgMoves: Math.round(avg(moveCounts)),
        },
        recentGames,
      },
    };

    await redis.set(cacheKey, JSON.stringify(payload), "EX", 30);
    return res.json(payload);
  } catch (e) {
    console.error("[users/profile] error", username, e);
    return res.status(500).json({ ok: false, error: "INTERNAL" });
  }
});

