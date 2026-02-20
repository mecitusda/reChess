import { Chess } from "chess.js";
import { nanoid } from "nanoid";
import { redis } from "../config/redis.js";

import { applyMove, createGame, loadGame, saveGame } from "../engine/gameEngine.js";
import { persistGameResultIfNeeded } from "../services/persistGameResult.js";
import { speedFromClock, getCurrentRating, applyRatedGameResult } from "../services/rating.service.js";
const readyMs = 30 * 1000;
const CLAIM_WIN_MS = 50 * 1000;
function makeJoinCode() {
  return nanoid(7).toUpperCase();
}

function mapGameToClient(game, opts = {}) {
  const chess = new Chess(game.fen);
  const speed = speedFromClock({ initialMs: game.initialMs, incrementMs: game.incrementMs });
  const whiteRating =
    opts.whiteRating ?? game.whiteRatingAfter ?? null;
  const blackRating =
    opts.blackRating ?? game.blackRatingAfter ?? null;

  return {
    gameId: game.gameId,
    joinCode: game.joinCode || null,
    initialMs: game.initialMs || 0,
    incrementMs: game.incrementMs || 0,
    whiteName: game.whiteName || null,
    blackName: game.blackName || null,
    whiteIdentity: game.whiteIdentity || null,
    blackIdentity: game.blackIdentity || null,
    fen: game.fen,
    turn: chess.turn(),
    status:
      game.state === "ACTIVE"
        ? "active"
        : game.state === "FINISHED"
        ? "finished"
        : "waiting",
    winner: game.winner || null,
    reason: game.finishReason || null,
    whiteTime: game.whiteTime,
    blackTime: game.blackTime,
    serverNow: Date.now(),
    readyDeadline: game.readyDeadline || null,
    lastMove: game.lastMoveFrom && game.lastMoveTo
      ? { from: game.lastMoveFrom, to: game.lastMoveTo }
      : null,
    disconnected: {
      white: !!game.disconnectedWhiteAt,
      black: !!game.disconnectedBlackAt,
      whiteAt: game.disconnectedWhiteAt || null,
      blackAt: game.disconnectedBlackAt || null,
    },
    whiteRating,
    blackRating,
    whiteRatingDiff:
      game.whiteRatingAfter != null && game.whiteRatingBefore != null
        ? game.whiteRatingAfter - game.whiteRatingBefore
        : null,
    blackRatingDiff:
      game.blackRatingAfter != null && game.blackRatingBefore != null
        ? game.blackRatingAfter - game.blackRatingBefore
        : null,
  };
}

async function getMappedGame(game) {
  const speed = speedFromClock({ initialMs: game.initialMs, incrementMs: game.incrementMs });
  const whiteRating =
    game.whiteRatingAfter ?? (await getCurrentRating(game.whiteIdentity, speed));
  const blackRating =
    game.blackRatingAfter ?? (await getCurrentRating(game.blackIdentity, speed));
  return mapGameToClient(game, { whiteRating, blackRating });
}


async function getEndedPayload(gameId, basePayload) {
  let game = await loadGame(gameId);
  let ratingPayload = {};
  try {
    const result = await applyRatedGameResult(game);
    if (result?.ok && result.whiteRating != null) {
      ratingPayload = {
        whiteRating: result.whiteRating,
        blackRating: result.blackRating,
        whiteRatingDiff: result.whiteRatingDiff ?? null,
        blackRatingDiff: result.blackRatingDiff ?? null,
      };
      game = await loadGame(gameId);
    }
  } catch (e) {
    console.error("[getEndedPayload] rating error", gameId, e);
  }
  return { ...basePayload, ...ratingPayload };
}

export function registerGameSocket(io, socket) {
  const SOCKET_GAME_TTL_SEC = 60 * 60 * 6;
  const SOCKET_META_TTL_SEC = 60 * 60; 

  async function resolveSocketIdentity() {
    const existing = await redis.get(`socket:${socket.id}:identity`);
    if (existing) return existing;

    const gidRaw = socket.handshake?.auth?.guestId;
    const gid = typeof gidRaw === "string" ? gidRaw.trim().slice(0, 64) : "";
    const identity = `guest:${gid || socket.id.slice(0, 8)}`;

    await redis.set(`socket:${socket.id}:identity`, identity, "EX", SOCKET_META_TTL_SEC);
    return identity;
  }
  socket.on("game:create", async (payload, ack) => {
  try {
  const gameId = nanoid(10);
  const joinCode = makeJoinCode();
  const initialMs = (payload?.initial ?? 5) * 60 * 1000;
  const incrementMs = (payload?.increment ?? 0) * 1000;

  const whiteIdentity = await resolveSocketIdentity();
  const whiteName =
    (await redis.get(`identity:${whiteIdentity}:name`)) ||
    (await redis.get(`socket:${socket.id}:name`)) ||
    `Guest${socket.id.slice(0, 4)}`;

  const game = await createGame({
    gameId,
    joinCode,
    whiteName,
    whiteIdentity,
    whiteId: socket.id,
    blackId: null,
    initialMs,
    incrementMs,
    rated: false,
  });

  await redis.set(`join:${joinCode}`, gameId, "EX", 60 * 60 * 24);
  await redis.set(`activeGame:${whiteIdentity}`, gameId, "EX", 60 * 60 * 6);
  await redis.zadd(`activeGamesZ:${whiteIdentity}`, Date.now(), gameId);
  await redis.expire(`activeGamesZ:${whiteIdentity}`, 60 * 60 * 24 * 7);

  socket.join(`game:${gameId}`);
  await redis.set(`socket:${socket.id}`, gameId, "EX", SOCKET_GAME_TTL_SEC);

  io.to(`game:${gameId}`).emit(
    "game:state",
    await getMappedGame(game)
  );

  ack?.({ ok: true, data: { gameId, joinCode }, color: "white" });
  } catch (e) {
    console.error("[game:create] error", e);
    ack?.({ ok: false, error: e?.message || "INTERNAL" });
  }
});



  socket.on("game:join", async ({ gameId, joinCode }, ack) => {
  try {
  if (gameId && !joinCode) {
    return ack?.({ ok: false, error: "JOIN_CODE_REQUIRED" });
  }

  let resolvedGameId = gameId;
  if (!resolvedGameId && joinCode) {
    resolvedGameId = await redis.get(`join:${String(joinCode).toUpperCase()}`);
  }
  if (!resolvedGameId) {
    return ack?.({ ok: false, error: "GAME_NOT_FOUND" });
  }

  const key = `game:${resolvedGameId}`;
  const game = await redis.hgetall(key);
  if (!game?.fen) {
    return ack?.({ ok: false, error: "GAME_NOT_FOUND" });
  }
  if (game.state === "FINISHED") {
    return ack?.({ ok: false, error: "GAME_ENDED" });
  }

  const identity = await resolveSocketIdentity();

  if (
    (game.whiteIdentity && game.whiteIdentity === identity) ||
    (game.blackIdentity && game.blackIdentity === identity) ||
    game.whiteId === socket.id ||
    game.blackId === socket.id
  ) {
    return ack?.({ ok: false, error: "SAME_PLAYER" });
  }

  if (game.blackId) {
    return ack?.({ ok: false, error: "GAME_FULL" });
  }

  await redis.hset(key, {
    blackId: socket.id,
  });

  const blackIdentity = identity;
  const blackName =
    (await redis.get(`identity:${blackIdentity}:name`)) ||
    (await redis.get(`socket:${socket.id}:name`)) ||
    `Guest${socket.id.slice(0, 4)}`;
  await redis.hset(key, { blackName, blackIdentity });
  await redis.set(`activeGame:${blackIdentity}`, resolvedGameId, "EX", 60 * 60 * 6);
  await redis.zadd(`activeGamesZ:${blackIdentity}`, Date.now(), resolvedGameId);
  await redis.expire(`activeGamesZ:${blackIdentity}`, 60 * 60 * 24 * 7);

  socket.join(`game:${resolvedGameId}`);
  await redis.set(`socket:${socket.id}`, resolvedGameId, "EX", SOCKET_GAME_TTL_SEC);

  const updated = await loadGame(resolvedGameId);

  io.to(`game:${resolvedGameId}`).emit(
    "game:state",
    await getMappedGame(updated)
  );

  ack?.({ ok: true, data: { gameId: resolvedGameId, joinCode: updated.joinCode || null }, color: "black" });
  } catch (e) {
    console.error("[game:join] error", e);
    ack?.({ ok: false, error: e?.message || "INTERNAL" });
  }
});


  socket.on("game:move", async ({ gameId, from, to, promotion }, ack) => {
  try {
    const identity = await resolveSocketIdentity();
    const game = await applyMove(gameId, socket.id, identity, { from, to, promotion });

    io.to(`game:${gameId}`).emit(
      "game:state",
      await getMappedGame(game)
    );

    if (game.state === "FINISHED") {
      const endedPayload = await getEndedPayload(gameId, {
        gameId,
        status: "finished",
        reason: game.finishReason,
        winner: game.winner,
      });
      io.to(`game:${gameId}`).emit("game:ended", endedPayload);

      await redis.hset(`game:${gameId}`, { _endedEmitted: "1" });

      await persistGameResultIfNeeded(game);

      const updated = await loadGame(gameId);
      io.to(`game:${gameId}`).emit("game:state", await getMappedGame(updated));
    }

    ack?.({ ok: true });
  } catch (err) {
    ack?.({ ok: false, error: err.message });
  }
});

  

  socket.on("game:request_sync", async ({ gameId }, ack) => {
  try {
  const data = await redis.hgetall(`game:${gameId}`);
  if (!data?.fen) {
    return ack?.({ ok: false, error: "GAME_NOT_FOUND" });
  }
  const identity = await resolveSocketIdentity();

  let myColor = null;
  if (data.whiteId === socket.id) myColor = "w";
  else if (data.blackId === socket.id) myColor = "b";
  else if (data.whiteIdentity && data.whiteIdentity === identity) myColor = "w";
  else if (data.blackIdentity && data.blackIdentity === identity) myColor = "b";

  socket.join(`game:${gameId}`);

  if (myColor) {
    await redis.set(`socket:${socket.id}`, gameId, "EX", SOCKET_GAME_TTL_SEC);
  }

  const now = Date.now();

  if (myColor === "w") {
    await redis.hset(`game:${gameId}`, { whiteId: socket.id, disconnectedWhiteAt: 0 });
  }
  if (myColor === "b") {
    await redis.hset(`game:${gameId}`, { blackId: socket.id, disconnectedBlackAt: 0 });
  }

  let moves = [];
  try {
    const rawMoves = await redis.lrange(`game:${gameId}:moves`, 0, -1);
    moves = rawMoves.map((m) => {
      try {
        return JSON.parse(m);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
  }

  ack?.({
    ok: true,
    data: {
      gameId,
      joinCode: data.joinCode || null,
      initialMs: Number(data.initialMs || 0),
      incrementMs: Number(data.incrementMs || 0),
      whiteName: data.whiteName || null,
      blackName: data.blackName || null,
      fen: data.fen,
      moves,
      readyDeadline: data.readyDeadline ? Number(data.readyDeadline) : null,
      status:
        data.state === "ACTIVE"
          ? "active"
          : data.state === "FINISHED"
          ? "finished"
          : "waiting",
      winner: data.winner ? String(data.winner) : null,
      reason: data.finishReason ? String(data.finishReason) : null,

      turn: new Chess(data.fen).turn(),
      whiteTime: Number(data.whiteTime),
      blackTime: Number(data.blackTime),
      serverNow: now,
      myColor,
      disconnected: {
        white: Number(data.disconnectedWhiteAt || 0) > 0,
        black: Number(data.disconnectedBlackAt || 0) > 0,
        whiteAt: Number(data.disconnectedWhiteAt || 0) || null,
        blackAt: Number(data.disconnectedBlackAt || 0) || null,
      },
      
      lastMove:
        data.lastMoveFrom && data.lastMoveTo
          ? {
              from: data.lastMoveFrom,
              to: data.lastMoveTo,
            }
          : null,
    },
  });
  } catch (e) {
    console.error("[game:request_sync] error", gameId, e);
    ack?.({ ok: false, error: e?.message || "INTERNAL" });
  }
});


 socket.on("game:resign", async ({ gameId }, ack) => {
  try {
    const game = await loadGame(gameId);

    const identity = await resolveSocketIdentity();
    const isWhite =
      game.whiteId === socket.id ||
      (game.whiteIdentity && game.whiteIdentity === identity);
    const isBlack =
      game.blackId === socket.id ||
      (game.blackIdentity && game.blackIdentity === identity);
    if (!isWhite && !isBlack) return ack?.({ ok: false, error: "NOT_IN_GAME" });

    if (game.state === "READY_WHITE" || game.state === "READY_BLACK") {
      if (game.joinCode) await redis.del(`join:${String(game.joinCode).toUpperCase()}`);
      game.state = "FINISHED";
      game.finishReason = "aborted";
      game.winner = null;
      await saveGame(game);
      if (game.whiteIdentity) await redis.del(`activeGame:${game.whiteIdentity}`);
      if (game.blackIdentity) await redis.del(`activeGame:${game.blackIdentity}`);
      if (game.whiteIdentity) await redis.zrem(`activeGamesZ:${game.whiteIdentity}`, gameId);
      if (game.blackIdentity) await redis.zrem(`activeGamesZ:${game.blackIdentity}`, gameId);
      io.to(`game:${gameId}`).emit("game:ended", {
        gameId,
        status: "finished",
        reason: "aborted",
        winner: null,
      });
      io.to(`game:${gameId}`).emit("game:state", await getMappedGame(game));
      await persistGameResultIfNeeded(game);
      return ack?.({ ok: true });
    }

    if (game.state !== "ACTIVE") {
      return ack?.({ ok: false, error: "NOT_ACTIVE" });
    }

    let winner = null;
    if (isWhite) winner = "black";
    if (isBlack) winner = "white";

    game.state = "FINISHED";
    game.finishReason = "resign";
    game.winner = winner;
    await saveGame(game);
    if (game.whiteIdentity) await redis.del(`activeGame:${game.whiteIdentity}`);
    if (game.blackIdentity) await redis.del(`activeGame:${game.blackIdentity}`);
    if (game.whiteIdentity) await redis.zrem(`activeGamesZ:${game.whiteIdentity}`, gameId);
    if (game.blackIdentity) await redis.zrem(`activeGamesZ:${game.blackIdentity}`, gameId);

    const endedPayload = await getEndedPayload(gameId, {
      gameId,
      status: "finished",
      reason: "resign",
      winner,
    });
    io.to(`game:${gameId}`).emit("game:ended", endedPayload);

    const updated = await loadGame(gameId);
    io.to(`game:${gameId}`).emit("game:state", await getMappedGame(updated));

    await persistGameResultIfNeeded(game);

    ack?.({ ok: true });
  } catch (e) {
    ack?.({ ok: false, error: e.message });
  }
});


  socket.on("game:draw_offer", async ({ gameId }, ack) => {
  try {
    const game = await loadGame(gameId);
    if (game.state !== "ACTIVE") {
      return ack?.({ ok: false, error: "NOT_ACTIVE" });
    }

    const by =
      game.whiteId === socket.id ? "white" :
      game.blackId === socket.id ? "black" : null;
    if (!by) return ack?.({ ok: false, error: "NOT_IN_GAME" });

    await redis.set(`game:${gameId}:drawOfferBy`, by, "EX", 60);

    const opp = by === "white" ? game.blackId : game.whiteId;
    io.to(opp).emit("game:draw_offered", { by });

    ack?.({ ok: true });
  } catch (e) {
    console.error("[game:draw_offer] error", gameId, e);
    ack?.({ ok: false, error: e?.message || "INTERNAL" });
  }
});

  socket.on("game:draw_decline", async ({ gameId }, ack) => {
    try {
      await redis.del(`game:${gameId}:drawOfferBy`);
      io.to(`game:${gameId}`).emit("game:draw_declined");
      ack?.({ ok: true });
    } catch (e) {
      console.error("[game:draw_decline] error", gameId, e);
      ack?.({ ok: false, error: e?.message || "INTERNAL" });
    }
  });

  socket.on("game:draw_accept", async ({ gameId }, ack) => {
  try {
    const game = await loadGame(gameId);
    if (game.state !== "ACTIVE") {
      return ack?.({ ok: false, error: "NOT_ACTIVE" });
    }

    const offeredBy = await redis.get(`game:${gameId}:drawOfferBy`);
    if (!offeredBy) return ack?.({ ok: false, error: "NO_OFFER" });

    game.state = "FINISHED";
    game.finishReason = "draw_agreed";
    game.winner = "draw";
    await saveGame(game);
    if (game.whiteIdentity) await redis.del(`activeGame:${game.whiteIdentity}`);
    if (game.blackIdentity) await redis.del(`activeGame:${game.blackIdentity}`);
    if (game.whiteIdentity) await redis.zrem(`activeGamesZ:${game.whiteIdentity}`, gameId);
    if (game.blackIdentity) await redis.zrem(`activeGamesZ:${game.blackIdentity}`, gameId);
    await redis.del(`game:${gameId}:drawOfferBy`);

    const endedPayload = await getEndedPayload(gameId, {
      gameId,
      status: "finished",
      reason: "draw_agreed",
      winner: "draw",
    });
    io.to(`game:${gameId}`).emit("game:ended", endedPayload);

    const updated = await loadGame(gameId);
    io.to(`game:${gameId}`).emit("game:state", await getMappedGame(updated));

    await persistGameResultIfNeeded(game);

    ack?.({ ok: true });
  } catch (e) {
    console.error("[game:draw_accept] error", gameId, e);
    ack?.({ ok: false, error: e?.message || "INTERNAL" });
  }
});

  socket.on("game:abort", async ({ gameId }, ack) => {
    try {
      const game = await loadGame(gameId);
      if (game.state !== "READY_WHITE" && game.state !== "READY_BLACK") {
        return ack?.({ ok: false, error: "NOT_ABORTABLE" });
      }

      const identity =
        (await redis.get(`socket:${socket.id}:identity`)) || `guest:${socket.id}`;

      const isWhite =
        game.whiteId === socket.id || (game.whiteIdentity && game.whiteIdentity === identity);
      const isBlack =
        game.blackId === socket.id || (game.blackIdentity && game.blackIdentity === identity);
      if (!isWhite && !isBlack) return ack?.({ ok: false, error: "NOT_IN_GAME" });

      game.state = "FINISHED";
      game.finishReason = "aborted";
      game.winner = null;
      await saveGame(game);

      if (game.joinCode) {
        await redis.del(`join:${String(game.joinCode).toUpperCase()}`);
      }

      if (game.whiteIdentity) await redis.del(`activeGame:${game.whiteIdentity}`);
      if (game.blackIdentity) await redis.del(`activeGame:${game.blackIdentity}`);
      if (game.whiteIdentity) await redis.zrem(`activeGamesZ:${game.whiteIdentity}`, gameId);
      if (game.blackIdentity) await redis.zrem(`activeGamesZ:${game.blackIdentity}`, gameId);

      io.to(`game:${gameId}`).emit("game:ended", {
        gameId,
        status: "finished",
        reason: "aborted",
        winner: null,
      });
      io.to(`game:${gameId}`).emit("game:state", await getMappedGame(game));

      await persistGameResultIfNeeded(game);

      ack?.({ ok: true });
    } catch (e) {
      console.error("[game:abort] error", gameId, e);
      ack?.({ ok: false, error: e?.message || "INTERNAL" });
    }
  });

  socket.on("game:claim_win", async ({ gameId }, ack) => {
    try {
      const game = await loadGame(gameId);
      if (game.state !== "ACTIVE") {
        return ack?.({ ok: false, error: "NOT_ACTIVE" });
      }

      const identity = await resolveSocketIdentity();

      const color =
        game.whiteId === socket.id || (game.whiteIdentity && game.whiteIdentity === identity)
          ? "w"
          : game.blackId === socket.id || (game.blackIdentity && game.blackIdentity === identity)
          ? "b"
          : null;
      if (!color) return ack?.({ ok: false, error: "NOT_IN_GAME" });

      const now = Date.now();
      const oppDisconnectedAt =
        color === "w" ? game.disconnectedBlackAt : game.disconnectedWhiteAt;

      if (!oppDisconnectedAt || now - oppDisconnectedAt < CLAIM_WIN_MS) {
        return ack?.({ ok: false, error: "NOT_CLAIMABLE" });
      }

      game.state = "FINISHED";
      game.finishReason = "disconnect_timeout";
      game.winner = color === "w" ? "white" : "black";
      await saveGame(game);

      if (game.whiteIdentity) await redis.del(`activeGame:${game.whiteIdentity}`);
      if (game.blackIdentity) await redis.del(`activeGame:${game.blackIdentity}`);
      if (game.whiteIdentity) await redis.zrem(`activeGamesZ:${game.whiteIdentity}`, gameId);
      if (game.blackIdentity) await redis.zrem(`activeGamesZ:${game.blackIdentity}`, gameId);

      const endedPayload = await getEndedPayload(gameId, {
        gameId,
        status: "finished",
        reason: "disconnect_timeout",
        winner: game.winner,
      });
      io.to(`game:${gameId}`).emit("game:ended", endedPayload);

      const updated = await loadGame(gameId);
      io.to(`game:${gameId}`).emit("game:state", await getMappedGame(updated));

      await persistGameResultIfNeeded(game);

      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });

  socket.on("game:reconnected", async ({ gameId }) => {
  try {
    const key = `game:${gameId}`;
    const game = await redis.hgetall(key);
    if (!game || game.state !== "ACTIVE") return;

    const identity = await resolveSocketIdentity();

    if (game.whiteIdentity && game.whiteIdentity === identity) {
      await redis.hset(key, { whiteId: socket.id, disconnectedWhiteAt: 0 });
    }

    if (game.blackIdentity && game.blackIdentity === identity) {
      await redis.hset(key, { blackId: socket.id, disconnectedBlackAt: 0 });
    }

    const updated = await loadGame(gameId);

    io.to(`game:${gameId}`).emit(
      "game:state",
      await getMappedGame(updated)
    );
  } catch (e) {
    console.error("[game:reconnected] error", gameId, e);
  }
});


  socket.on("disconnect", async () => {
    try {
      const gameId = await redis.get(`socket:${socket.id}`);
      if (!gameId) return;
      
      const key = `game:${gameId}`;
      const game = await redis.hgetall(key);
      if (!game || !game.state) return;

      if (game.state === "READY_WHITE" || game.state === "READY_BLACK") {
        await redis.del(`socket:${socket.id}`);
        return;
      }
 
      if (game.state === "ACTIVE") {
        if (game.whiteId === socket.id) {
          await redis.hset(key, { disconnectedWhiteAt: Date.now() });
        }
        if (game.blackId === socket.id) {
          await redis.hset(key, { disconnectedBlackAt: Date.now() });
        }
      }
      const updated = await loadGame(gameId);

      io.to(`game:${gameId}`).emit(
        "game:state",
        await getMappedGame(updated)
      );
    
      await redis.del(`socket:${socket.id}`);
    } catch (e) {
      console.error("[disconnect cleanup] error", e);
      try {
        await redis.del(`socket:${socket.id}`);
      } catch {

      }
    }
  });





}