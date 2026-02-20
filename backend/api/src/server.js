import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { registerSockets } from "./sockets/index.js";
import { connectDb } from "./config/db.js";
import dotenv from "dotenv";
import { redis } from "./config/redis.js";
import { tickGame, loadGame } from "./engine/gameEngine.js";
import { Chess } from "chess.js";
import { persistGameResultIfNeeded } from "./services/persistGameResult.js";
import { applyRatedGameResult } from "./services/rating.service.js";
import { authRouter } from "./routes/auth.routes.js";
import { gamesRouter } from "./routes/games.routes.js";
import { statsRouter } from "./routes/stats.routes.js";
import { usersRouter } from "./routes/users.routes.js";
dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use("/auth", authRouter);
app.use("/games", gamesRouter);
app.use("/stats", statsRouter);
app.use("/users", usersRouter);
await connectDb();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

registerSockets(io);




setInterval(async () => {
  try {
    const keys = await redis.keys("game:*");

    for (const key of keys) {

      if (!/^game:[^:]+$/.test(key)) continue;

      const gameId = key.split(":")[1];

      let game = null;
      try {
        game = await tickGame(gameId);
      } catch (e) {
         
        if (e?.message === "GAME_NOT_FOUND") {
          try {
            await redis.del(key);
          } catch {
             
          }
          continue;
        }
        console.error("[tickGame] error", gameId, e);
        continue;
      }

      if (!game) continue;

      try {
        
        await persistGameResultIfNeeded(game);

        
        try {
          await applyRatedGameResult(game);
          game = await loadGame(gameId);
        } catch (e) {
          console.error("[rating] error", gameId, e);
        }

        
        if (game.state === "FINISHED" && !game._endedEmitted) {
          const whiteRating = game.whiteRatingAfter ?? null;
          const blackRating = game.blackRatingAfter ?? null;
          const whiteRatingDiff =
            game.whiteRatingAfter != null && game.whiteRatingBefore != null
              ? game.whiteRatingAfter - game.whiteRatingBefore
              : null;
          const blackRatingDiff =
            game.blackRatingAfter != null && game.blackRatingBefore != null
              ? game.blackRatingAfter - game.blackRatingBefore
              : null;
          io.to(`game:${gameId}`).emit("game:ended", {
            gameId,
            status: "finished",
            reason: game.finishReason,
            winner: game.winner,
            whiteRating,
            blackRating,
            whiteRatingDiff,
            blackRatingDiff,
          });

          await redis.hset(`game:${game.gameId}`, { _endedEmitted: "1" });
        }

        
        io.to(`game:${gameId}`).emit("game:state", {
          gameId,
          fen: game.fen,
          turn: new Chess(game.fen).turn(),
          initialMs: game.initialMs || 0,
          incrementMs: game.incrementMs || 0,
          whiteName: game.whiteName || null,
          blackName: game.blackName || null,
          whiteIdentity: game.whiteIdentity || null,
          blackIdentity: game.blackIdentity || null,
          whiteTime: game.whiteTime,
          blackTime: game.blackTime,
          disconnected: {
            white: !!game.disconnectedWhiteAt,
            black: !!game.disconnectedBlackAt,
            whiteAt: game.disconnectedWhiteAt || null,
            blackAt: game.disconnectedBlackAt || null,
          },
          status:
            game.state === "ACTIVE"
              ? "active"
              : game.state === "FINISHED"
                ? "finished"
                : "waiting",
          serverNow: Date.now(),
          whiteRating: game.whiteRatingAfter ?? null,
          blackRating: game.blackRatingAfter ?? null,
          whiteRatingDiff:
            game.whiteRatingAfter != null && game.whiteRatingBefore != null
              ? game.whiteRatingAfter - game.whiteRatingBefore
              : null,
          blackRatingDiff:
            game.blackRatingAfter != null && game.blackRatingBefore != null
              ? game.blackRatingAfter - game.blackRatingBefore
              : null,

          lastMove:
            game.lastMoveFrom && game.lastMoveTo
              ? {
                  from: game.lastMoveFrom,
                  to: game.lastMoveTo,
                }
              : null,
        });
      } catch (e) {
        console.error("[tickGame] post-processing error", gameId, e);
      }
    }
  } catch (e) {
    console.error("[tickLoop] error", e);
  }
}, 1000);





server.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});
