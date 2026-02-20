import { nanoid } from "nanoid";
import { redis } from "../config/redis.js";
import { createGame } from "../engine/gameEngine.js";
import { UserRating } from "../models/UserRating.js";
import { speedFromClock } from "../services/rating.service.js";

function queueZKey(initial, increment) {
  return `queue:z:${initial}+${increment}`;
}

export function registerQueueSocket(io, socket) {
  const QUEUE_MEMBER_TTL_SEC = 60 * 30;

  async function cleanupQueueMember(socketId, qKey) {
    if (qKey) {
      await redis.zrem(qKey, socketId);
    }
    await redis.del(`queue:member:${socketId}`);
    await redis.del(`queue:joinedAt:${socketId}`);
  }

  async function cleanupStaleCandidate(socketId) {
    const qKey = await redis.get(`queue:member:${socketId}`);
    if (qKey) await redis.zrem(qKey, socketId);
    await redis.del(`queue:member:${socketId}`);
    await redis.del(`queue:joinedAt:${socketId}`);
  }

  async function getMatchRating({ identity, initial, increment }) {

    if (!String(identity || "").startsWith("user:")) return 1500;

    const userId = String(identity).slice("user:".length);
    const speed = speedFromClock({
      initialMs: Number(initial || 0) * 60 * 1000,
      incrementMs: Number(increment || 0) * 1000,
    });

    const cacheKey = `rating:${userId}:${speed}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      const n = Number(cached);
      return Number.isFinite(n) ? n : 1500;
    }

    const doc = await UserRating.findOne({ userId, speed }).select({ rating: 1 }).lean();
    const r = Number(doc?.rating);
    const rating = Number.isFinite(r) ? r : 1500;
    await redis.set(cacheKey, String(rating), "EX", 60);
    return rating;
  }

  const matchScript = `
    local key = KEYS[1]
    local myId = ARGV[1]
    local myRating = tonumber(ARGV[2])
    local myIdentity = ARGV[3]
    local nowMs = tonumber(ARGV[4])

    local function band(waitSec)
      local b = 100 + math.floor(waitSec / 10) * 50
      if b > 1000 then b = 1000 end
      return b
    end

    local myJoinedAt = tonumber(redis.call('GET', 'queue:joinedAt:' .. myId) or nowMs)
    local myWaitSec = math.floor(math.max(0, (nowMs - myJoinedAt)) / 1000)
    local myBand = band(myWaitSec)

    local function consider(bestId, bestDiff, candId, candRating)
      if candId == false or candId == nil then return bestId, bestDiff end
      if candId == myId then return bestId, bestDiff end

      local candIdentity = redis.call('GET', 'socket:' .. candId .. ':identity') or ''
      if candIdentity == myIdentity then return bestId, bestDiff end

      local candJoinedAt = tonumber(redis.call('GET', 'queue:joinedAt:' .. candId) or nowMs)
      local candWaitSec = math.floor(math.max(0, (nowMs - candJoinedAt)) / 1000)
      local candBand = band(candWaitSec)
      local allowed = myBand
      if candBand > allowed then allowed = candBand end

      local diff = math.abs(candRating - myRating)
      if diff > allowed then return bestId, bestDiff end

      if bestId == nil or diff < bestDiff then
        return candId, diff
      end
      return bestId, bestDiff
    end

    local minScore = myRating - 1000
    local maxScore = myRating + 1000

    local below = redis.call('ZREVRANGEBYSCORE', key, myRating, minScore, 'WITHSCORES', 'LIMIT', 0, 10)
    local above = redis.call('ZRANGEBYSCORE', key, myRating, maxScore, 'WITHSCORES', 'LIMIT', 0, 10)

    local bestId = nil
    local bestDiff = nil

    for i = 1, #below, 2 do
      bestId, bestDiff = consider(bestId, bestDiff, below[i], tonumber(below[i+1]))
    end
    for i = 1, #above, 2 do
      bestId, bestDiff = consider(bestId, bestDiff, above[i], tonumber(above[i+1]))
    end

    if bestId ~= nil then
      redis.call('ZREM', key, myId)
      redis.call('ZREM', key, bestId)
      return { bestId }
    end
    return {}
  `;

  socket.on("queue:join", async ({ initial, increment }) => {
    try {
    if (typeof initial !== "number" || typeof increment !== "number") return;

    const qKey = queueZKey(initial, increment);

    const identity =
      (await redis.get(`socket:${socket.id}:identity`)) || `guest:${socket.id.slice(0, 8)}`;
    const activeGameId = await redis.get(`activeGame:${identity}`);
    if (activeGameId) {
      socket.emit("queue:blocked", { reason: "ACTIVE_GAME", gameId: activeGameId });
      return;
    }

    const already = await redis.get(`queue:member:${socket.id}`);
    if (already && already !== qKey) {
      await cleanupQueueMember(socket.id, already);
    } else if (already === qKey) {
      return; 
    }

    const rating = await getMatchRating({ identity, initial, increment });

    await redis.zadd(qKey, rating, socket.id);
    await redis.set(`queue:member:${socket.id}`, qKey, "EX", QUEUE_MEMBER_TTL_SEC);
    await redis.set(`queue:joinedAt:${socket.id}`, String(Date.now()), "EX", QUEUE_MEMBER_TTL_SEC);

    
    let opponentId = null;
    for (let tries = 0; tries < 3; tries += 1) {
      const res = await redis.eval(matchScript, 1, qKey, socket.id, String(rating), identity, String(Date.now()));
      const cand = Array.isArray(res) ? res[0] : null;
      if (!cand) break;

      if (!io.sockets.sockets.get(cand)) {
        await cleanupStaleCandidate(cand);
        await redis.zadd(qKey, rating, socket.id);
        continue;
      }
      opponentId = cand;
      break;
    }

    if (!opponentId) {
      socket.emit("queue:waiting", { initial, increment });
      return;
    }

    await cleanupQueueMember(socket.id, null);
    await cleanupQueueMember(opponentId, null);

    const gameId = nanoid(10);

    const otherIdentity =
      (await redis.get(`socket:${opponentId}:identity`)) || `guest:${String(opponentId).slice(0, 8)}`;

    const flip = Math.random() < 0.5;
    const whiteId = flip ? socket.id : opponentId;
    const blackId = flip ? opponentId : socket.id;
    const whiteIdentity = flip ? identity : otherIdentity;
    const blackIdentity = flip ? otherIdentity : identity;

    const whiteName =
      (await redis.get(`identity:${whiteIdentity}:name`)) ||
      (await redis.get(`socket:${whiteId}:name`)) ||
      `Guest${String(whiteId).slice(0, 4)}`;
    const blackName =
      (await redis.get(`identity:${blackIdentity}:name`)) ||
      (await redis.get(`socket:${blackId}:name`)) ||
      `Guest${String(blackId).slice(0, 4)}`;

    const game = await createGame({
      gameId,
      whiteId,
      blackId,
      whiteName,
      blackName,
      whiteIdentity,
      blackIdentity,
      initialMs: initial * 60 * 1000,
      incrementMs: increment * 1000,
      rated: true,
    });

    await redis.set(`activeGame:${whiteIdentity}`, gameId, "EX", 60 * 60 * 6);
    await redis.set(`activeGame:${blackIdentity}`, gameId, "EX", 60 * 60 * 6);
    await redis.zadd(`activeGamesZ:${whiteIdentity}`, Date.now(), gameId);
    await redis.zadd(`activeGamesZ:${blackIdentity}`, Date.now(), gameId);
    await redis.expire(`activeGamesZ:${whiteIdentity}`, 60 * 60 * 24 * 7);
    await redis.expire(`activeGamesZ:${blackIdentity}`, 60 * 60 * 24 * 7);

    // room join (SADECE game room)
    io.sockets.sockets.get(whiteId)?.join(`game:${gameId}`);
    io.sockets.sockets.get(blackId)?.join(`game:${gameId}`);

    // socket → game mapping
    await redis.set(`socket:${whiteId}`, gameId, "EX", 60 * 60 * 6);
    await redis.set(`socket:${blackId}`, gameId, "EX", 60 * 60 * 6);

    io.to(whiteId).emit("queue:matched", {
      gameId,
      color: "w",
      initial,
      increment,
    });

    io.to(blackId).emit("queue:matched", {
      gameId,
      color: "b",
      initial,
      increment,
    });
    } catch (e) {
      console.error("[queue:join] error", e);
    }
  });

  
  socket.on("queue:leave", async () => {
    try {
      const qKey = await redis.get(`queue:member:${socket.id}`);
      if (!qKey) return;

      await cleanupQueueMember(socket.id, qKey);
    } catch (e) {
      console.error("[queue:leave] error", e);
    }
  });

  
  socket.on("disconnect", async () => {
    try {
      const qKey = await redis.get(`queue:member:${socket.id}`);
      if (!qKey) return;

      await cleanupQueueMember(socket.id, qKey);
    } catch (e) {
      console.error("[queue:disconnect] error", e);
    }
  });
}
