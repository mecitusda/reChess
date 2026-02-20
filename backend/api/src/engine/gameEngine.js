import { Chess } from "chess.js";
import { redis } from "../config/redis.js";

const READY_MS = 30_000;

export const STATES = {
  READY_WHITE: "READY_WHITE",
  READY_BLACK: "READY_BLACK",
  ACTIVE: "ACTIVE",
  FINISHED: "FINISHED",
};

function now() {
  return Date.now();
}

function gameKey(gameId) {
  return `game:${gameId}`;
}

export function finishGame(game, { reason, winner }) {
  if (game.state === STATES.FINISHED) return game;

  game.state = STATES.FINISHED;
  game.finishReason = reason;
  game.winner = winner || null;
  return game;
}


function resolveColor(game, socketId, identity) {
  if (game.whiteId === socketId) return "w";
  if (game.blackId === socketId) return "b";

  if (identity && game.whiteIdentity && game.whiteIdentity === identity) return "w";
  if (identity && game.blackIdentity && game.blackIdentity === identity) return "b";

  return null;
}


export async function loadGame(gameId) {
  const data = await redis.hgetall(gameKey(gameId));
  if (!data || !data.fen) throw new Error("GAME_NOT_FOUND");

  return {
    gameId,
    state: data.state,
    fen: data.fen,
    joinCode: data.joinCode || "",
    whiteName: data.whiteName || "",
    blackName: data.blackName || "",
    whiteIdentity: data.whiteIdentity || "",
    blackIdentity: data.blackIdentity || "",
    whiteId: data.whiteId || null,
    blackId: data.blackId || null,
    initialMs: Number(data.initialMs || 0),        
    incrementMs: Number(data.incrementMs || 0),    
    rated: String(data.rated || "") === "1",
    whiteTime: Number(data.whiteTime),
    blackTime: Number(data.blackTime),
    readyDeadline: Number(data.readyDeadline || 0),
    lastTick: Number(data.lastTick || 0),
    lastMoveFrom: data.lastMoveFrom || "",         
    lastMoveTo: data.lastMoveTo || "",             
    pgn: data.pgn || "",                           
    disconnectedWhiteAt: Number(data.disconnectedWhiteAt || 0),
    disconnectedBlackAt: Number(data.disconnectedBlackAt || 0),
    winner: data.winner || null,
    finishReason: data.finishReason || null,
    whiteRatingBefore: data.whiteRatingBefore != null ? Number(data.whiteRatingBefore) : null,
    whiteRatingAfter: data.whiteRatingAfter != null ? Number(data.whiteRatingAfter) : null,
    blackRatingBefore: data.blackRatingBefore != null ? Number(data.blackRatingBefore) : null,
    blackRatingAfter: data.blackRatingAfter != null ? Number(data.blackRatingAfter) : null,
  };
}

export async function saveGame(game) {
  await redis.hset(gameKey(game.gameId), {
    state: game.state,
    fen: game.fen,
    joinCode: game.joinCode || "",
    whiteName: game.whiteName || "",
    blackName: game.blackName || "",
    whiteIdentity: game.whiteIdentity || "",
    blackIdentity: game.blackIdentity || "",
    whiteId: game.whiteId || "",
    blackId: game.blackId || "",
    initialMs: game.initialMs || 0,        
    incrementMs: game.incrementMs || 0,    
    rated: game.rated ? "1" : "0",
    whiteTime: game.whiteTime,
    blackTime: game.blackTime,
    readyDeadline: game.readyDeadline || 0,
    lastTick: game.lastTick || 0,
    lastMoveFrom: game.lastMoveFrom || "", 
    lastMoveTo: game.lastMoveTo || "",     
    pgn: game.pgn || "",                   
    disconnectedWhiteAt: game.disconnectedWhiteAt || 0,
    disconnectedBlackAt: game.disconnectedBlackAt || 0,
    winner: game.winner || "",
    finishReason: game.finishReason || "",
  });
}


export async function createGame({
  gameId,
  whiteId,
  blackId,
  joinCode,
  whiteName,
  blackName,
  whiteIdentity,
  blackIdentity,
  initialMs,
  incrementMs,
  rated,
}) {
  const chess = new Chess();

  const game = {
    gameId,
    state: STATES.READY_WHITE,
    fen: chess.fen(),
    joinCode: joinCode || "",
    whiteName: whiteName || "",
    blackName: blackName || "",
    whiteIdentity: whiteIdentity || "",
    blackIdentity: blackIdentity || "",
    whiteId,
    blackId,
    initialMs,         
    incrementMs,       
    rated: !!rated,
    whiteTime: initialMs,
    blackTime: initialMs,
    readyDeadline: now() + READY_MS,
    lastTick: now(),
    lastMoveFrom: "",
    lastMoveTo: "",
    pgn: "",
  };

  await saveGame(game);
  return game;
}



export async function applyMove(gameId, socketId, identity, { from, to, promotion = "q" }) {
  const game = await loadGame(gameId);
  const color = resolveColor(game, socketId, identity);
  if (!color) throw new Error("NOT_IN_GAME");

  const chess = new Chess(game.fen);

 
  if (chess.turn() !== color) {
    throw new Error("NOT_YOUR_TURN");
  }

  
  if (
  (game.state === STATES.READY_WHITE || game.state === STATES.READY_BLACK) &&
  now() > game.readyDeadline
) {
  finishGame(game, { reason: "aborted", winner: null });
  await saveGame(game);
  throw new Error("GAME_ABORTED");
}

  
  const move = chess.move({
    from,
    to,
    promotion: ["q", "r", "b", "n"].includes(promotion) ? promotion : "q",
  });
  if (!move) throw new Error("ILLEGAL_MOVE");

  game.fen = chess.fen();
  game.lastMoveFrom = from;
  game.lastMoveTo = to;

  
  await redis.rpush(`game:${gameId}:moves`, JSON.stringify({
    ply: chess.history().length,
    from,
    to,
    san: move.san,
    fen: game.fen,
    at: now(),
  }));

 
  await redis.expire(`game:${gameId}:moves`, 60 * 60 * 24); 

  game.pgn = chess.pgn();
  
  

  if (game.state === STATES.READY_WHITE) {
    if (color !== "w") throw new Error("NOT_READY_TURN");
    game.state = STATES.READY_BLACK;
    game.readyDeadline = now() + READY_MS;
    game.lastTick = now();
  } else if (game.state === STATES.READY_BLACK) {
    if (color !== "b") throw new Error("NOT_READY_TURN");
    game.state = STATES.ACTIVE;
    game.lastTick = now();
  } else if (game.state === STATES.ACTIVE) {
    const elapsed = now() - game.lastTick;
    if (color === "w") {
      game.whiteTime -= elapsed;
      game.whiteTime += game.incrementMs;
    } else {
      game.blackTime -= elapsed;
      game.blackTime += game.incrementMs;
    }
    game.lastTick = now();
  } else {
    throw new Error("GAME_NOT_ACTIVE");
  }

  
  if (chess.isCheckmate()) {
  finishGame(game, {
    reason: "checkmate",
    winner: chess.turn() === "w" ? "black" : "white",
  });
}


if (chess.isDraw()) {
  finishGame(game, {
    reason: "draw",
    winner: "draw",
  });
}

await saveGame(game);
if (game.state === STATES.FINISHED) {
  if (game.whiteIdentity) await redis.del(`activeGame:${game.whiteIdentity}`);
  if (game.blackIdentity) await redis.del(`activeGame:${game.blackIdentity}`);
  if (game.whiteIdentity) await redis.zrem(`activeGamesZ:${game.whiteIdentity}`, gameId);
  if (game.blackIdentity) await redis.zrem(`activeGamesZ:${game.blackIdentity}`, gameId);
}
return game;
}

export async function tickGame(gameId) {
  let game;
  try {
    game = await loadGame(gameId);
  } catch (e) {
    if (e?.message === "GAME_NOT_FOUND") return null;
    throw e;
  }
  const nowTs = now();
  if (
  (game.state === STATES.READY_WHITE ||
   game.state === STATES.READY_BLACK) &&
  game.readyDeadline &&
  nowTs > game.readyDeadline
) {
  finishGame(game, {
    reason: "aborted",
    winner: null,
  });

  await saveGame(game);
  if (game.joinCode) {
    await redis.del(`join:${String(game.joinCode).toUpperCase()}`);
  }
  if (game.whiteIdentity) await redis.del(`activeGame:${game.whiteIdentity}`);
  if (game.blackIdentity) await redis.del(`activeGame:${game.blackIdentity}`);
  if (game.whiteIdentity) await redis.zrem(`activeGamesZ:${game.whiteIdentity}`, gameId);
  if (game.blackIdentity) await redis.zrem(`activeGamesZ:${game.blackIdentity}`, gameId);
  return game;
}
  if (game.state !== STATES.ACTIVE) return null;

  

  const chess = new Chess(game.fen);
  const elapsed = nowTs - game.lastTick;

  if (chess.turn() === "w") game.whiteTime -= elapsed;
  else game.blackTime -= elapsed;

  game.lastTick = nowTs;

  if (game.whiteTime <= 0) {
    finishGame(game, { reason: "timeout", winner: "black" });
  }

  if (game.blackTime <= 0) {
    finishGame(game, { reason: "timeout", winner: "white" });
  }

  await saveGame(game);
  if (game.state === STATES.FINISHED) {
    if (game.whiteIdentity) await redis.del(`activeGame:${game.whiteIdentity}`);
    if (game.blackIdentity) await redis.del(`activeGame:${game.blackIdentity}`);
    if (game.whiteIdentity) await redis.zrem(`activeGamesZ:${game.whiteIdentity}`, gameId);
    if (game.blackIdentity) await redis.zrem(`activeGamesZ:${game.blackIdentity}`, gameId);
  }
  return game;
}



export async function resignGame(gameId, socketId) {
  const game = await loadGame(gameId);

  if (game.state !== STATES.ACTIVE) {
    throw new Error("NOT_ACTIVE");
  }

  if (game.whiteId === socketId) {
    game.state = STATES.FINISHED;
    game.finishReason = "resign";
    game.winner = "black";
  } else if (game.blackId === socketId) {
    game.state = STATES.FINISHED;
    game.finishReason = "resign";
    game.winner = "white";
  } else {
    throw new Error("NOT_IN_GAME");
  }

  await saveGame(game);
  return game;
}


export async function acceptDraw(gameId) {
  const game = await loadGame(gameId);

  if (game.state !== STATES.ACTIVE) {
    throw new Error("NOT_ACTIVE");
  }

  game.state = STATES.FINISHED;
  game.finishReason = "draw_agreed";
  game.winner = "draw";

  await saveGame(game);
  return game;
}
