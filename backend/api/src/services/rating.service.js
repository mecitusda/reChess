import { redis } from "../config/redis.js";
import { UserRating } from "../models/UserRating.js";
import { update1v1, initialRatingState } from "./glicko2.js";

const PROVISIONAL_GAMES = 10;

export function speedFromClock({ initialMs, incrementMs }) {
  const initialSec = Math.round(Number(initialMs || 0) / 1000);
  const incSec = Math.round(Number(incrementMs || 0) / 1000);
  const estimate = initialSec + 40 * incSec;

  if (estimate <= 179) return "bullet";
  if (estimate <= 479) return "blitz";
  if (estimate <= 1499) return "rapid";
  return "classical";
}

const DEFAULT_RATING = 1500;
const RATING_CACHE_TTL_SEC = 30;

export async function getCurrentRating(identity, speed) {
  if (!speed) return DEFAULT_RATING;
  const id = String(identity || "");
  if (!id.startsWith("user:")) return DEFAULT_RATING;
  const userId = id.slice("user:".length);
  const cacheKey = `rating:${userId}:${speed}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null && cached !== undefined) {
      const n = parseInt(cached, 10);
      if (Number.isFinite(n)) return n;
    }
  } catch {
    // ignore cache miss/error
  }
  const doc = await UserRating.findOne({ userId, speed }).select({ rating: 1 }).lean();
  const r = Number(doc?.rating);
  const out = Number.isFinite(r) ? r : DEFAULT_RATING;
  try {
    await redis.set(cacheKey, String(out), "EX", RATING_CACHE_TTL_SEC);
  } catch {
    // ignore
  }
  return out;
}

async function loadOrInit(userId, speed) {
  const found = await UserRating.findOne({ userId, speed }).lean();
  if (found?._id) return found;
  const init = initialRatingState();
  return await UserRating.create({
    userId,
    speed,
    rating: init.rating,
    rd: init.rd,
    vol: init.vol,
    games: 0,
    provisional: true,
  });
}

function scoreFromWinner({ winner, myColor }) {
  if (winner === "draw" || !winner) return 0.5;
  if (winner === myColor) return 1;
  return 0;
}


export async function applyRatedGameResult(game) {
  if (!game || game.state !== "FINISHED") return { ok: false, reason: "NOT_FINISHED" };
  if (!game.rated) return { ok: false, reason: "NOT_RATED" };
  if (game.finishReason === "aborted") return { ok: false, reason: "ABORTED" };

  const whiteUserId = String(game.whiteIdentity || "").startsWith("user:")
    ? String(game.whiteIdentity).slice("user:".length)
    : "";
  const blackUserId = String(game.blackIdentity || "").startsWith("user:")
    ? String(game.blackIdentity).slice("user:".length)
    : "";

  if (!whiteUserId || !blackUserId) return { ok: false, reason: "NO_BOTH_USERS" };

  const key = `game:${game.gameId}`;
  const already = await redis.hget(key, "_ratedApplied");
  if (already === "1") {
    const wb = Number(await redis.hget(key, "whiteRatingBefore"));
    const wa = Number(await redis.hget(key, "whiteRatingAfter"));
    const bb = Number(await redis.hget(key, "blackRatingBefore"));
    const ba = Number(await redis.hget(key, "blackRatingAfter"));
    return {
      ok: true,
      already: true,
      whiteRating: Number.isFinite(wa) ? wa : null,
      blackRating: Number.isFinite(ba) ? ba : null,
      whiteRatingDiff: Number.isFinite(wa) && Number.isFinite(wb) ? wa - wb : null,
      blackRatingDiff: Number.isFinite(ba) && Number.isFinite(bb) ? ba - bb : null,
    };
  }

  const speed = speedFromClock({ initialMs: game.initialMs, incrementMs: game.incrementMs });

  const whiteRating = await loadOrInit(whiteUserId, speed);
  const blackRating = await loadOrInit(blackUserId, speed);

  const scoreWhite = scoreFromWinner({ winner: game.winner, myColor: "white" });

  const { nextA, nextB } = update1v1({
    playerA: { rating: whiteRating.rating, rd: whiteRating.rd, vol: whiteRating.vol },
    playerB: { rating: blackRating.rating, rd: blackRating.rd, vol: blackRating.vol },
    scoreA: scoreWhite,
  });

  const nextWhiteGames = Number(whiteRating.games || 0) + 1;
  const nextBlackGames = Number(blackRating.games || 0) + 1;

  await UserRating.updateOne(
    { _id: whiteRating._id },
    {
      $set: {
        rating: Math.round(nextA.rating),
        rd: Math.round(nextA.rd),
        vol: nextA.vol,
        games: nextWhiteGames,
        provisional: nextWhiteGames < PROVISIONAL_GAMES,
      },
    }
  );

  await UserRating.updateOne(
    { _id: blackRating._id },
    {
      $set: {
        rating: Math.round(nextB.rating),
        rd: Math.round(nextB.rd),
        vol: nextB.vol,
        games: nextBlackGames,
        provisional: nextBlackGames < PROVISIONAL_GAMES,
      },
    }
  );

  const whiteAfter = Math.round(nextA.rating);
  const blackAfter = Math.round(nextB.rating);
  const whiteBefore = Number(whiteRating.rating);
  const blackBefore = Number(blackRating.rating);

  await redis.hset(key, {
    _ratedApplied: "1",
    whiteRatingBefore: String(whiteBefore),
    whiteRatingAfter: String(whiteAfter),
    blackRatingBefore: String(blackBefore),
    blackRatingAfter: String(blackAfter),
  });

  return {
    ok: true,
    speed,
    whiteRating: whiteAfter,
    blackRating: blackAfter,
    whiteRatingDiff: whiteAfter - whiteBefore,
    blackRatingDiff: blackAfter - blackBefore,
  };
}

