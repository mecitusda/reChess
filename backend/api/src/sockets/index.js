import { registerGameSocket } from "./game.socket.js";
import { registerQueueSocket } from "./queue.socket.js";
import { redis } from "../config/redis.js";
import { verifyToken } from "../auth/jwt.js";
import { User } from "../models/User.js";

function normalizeUsername(u) {
  return String(u || "").trim().toLowerCase().replace(/\s+/g, "");
}

export function registerSockets(io) {
  io.on("connection", (socket) => { 
    socket.emit("server:hello", { id: socket.id });
    const SOCKET_META_TTL_SEC = 60 * 60; 

    async function identify({ guestId, name, token } = {}, ack) {
      try {
        let identityKey = null;
        let identityName = null;
        let authed = false;

      if (typeof token === "string" && token.length > 10) {
        try {
          const payload = verifyToken(token);
          if (payload?.userId) {
            identityKey = `user:${payload.userId}`;
            identityName = payload.username || null;
            authed = true;
          }
        } catch {
        }
      }

      if (!identityKey) {
        const gid = typeof guestId === "string" ? guestId.trim().slice(0, 64) : "";
        identityKey = `guest:${gid || socket.id}`;
      }

      if (!authed && typeof name === "string") {
        const trimmed = name.trim().slice(0, 24);
        if (trimmed) identityName = trimmed;
      }

      await redis.set(`socket:${socket.id}:identity`, identityKey, "EX", SOCKET_META_TTL_SEC);
      if (identityName) {
        await redis.set(`identity:${identityKey}:name`, identityName, "EX", 60 * 60 * 24);
        await redis.set(`socket:${socket.id}:name`, identityName, "EX", SOCKET_META_TTL_SEC);
      }

      if (identityKey.startsWith("user:")) {
        const userId = identityKey.slice("user:".length);
        const now = Date.now();
        await redis.set(`presence:user:${userId}`, "1");
        await redis.set(`presence:user:${userId}:lastActive`, String(now), "EX", 60 * 60 * 24 * 365);
        const un = identityName ? normalizeUsername(identityName) : null;
        if (un) {
          await redis.set(`presence:user:${userId}:name`, un);
          io.to(`presence:${un}`).emit("presence:online", { username: un });
        }
      }

        const activeGameId = await redis.get(`activeGame:${identityKey}`);
        if (activeGameId) {
          socket.emit("user:active_game", { gameId: activeGameId });
        }

        ack?.({ ok: true, identity: identityKey });
      } catch (e) {
        console.error("[user:identify] error", e);
        ack?.({ ok: false, error: e?.message || "INTERNAL" });
      }
    }


    identify(socket.handshake?.auth || {});

    socket.on("user:identify", identify);

    socket.on("presence:subscribe", async ({ username }, ack) => {
      const un = normalizeUsername(username);
      if (!un) return ack?.({ ok: false, error: "BAD_USERNAME" });
      socket.join(`presence:${un}`);
      try {
        const user = await User.findOne({ username: un }).select({ _id: 1 }).lean();
        if (user) {
          const uid = String(user._id);
          const online = (await redis.get(`presence:user:${uid}`)) === "1";
          const lastActiveRaw = await redis.get(`presence:user:${uid}:lastActive`);
          const lastActiveAt = lastActiveRaw ? parseInt(lastActiveRaw, 10) : null;
          socket.emit("presence:status", { username: un, online, lastActiveAt: lastActiveAt || undefined });
        }
        ack?.({ ok: true });
      } catch (e) {
        console.error("[presence:subscribe] error", un, e);
        ack?.({ ok: false, error: "INTERNAL" });
      }
    });

    socket.on("presence:unsubscribe", ({ username }) => {
      const un = normalizeUsername(username);
      if (un) socket.leave(`presence:${un}`);
    });

    registerGameSocket(io, socket);
    registerQueueSocket(io, socket);

   
    socket.on("disconnect", async () => {
      try {
        const identityKey = await redis.get(`socket:${socket.id}:identity`);
        if (identityKey && identityKey.startsWith("user:")) {
          const userId = identityKey.slice("user:".length);
          const now = Date.now();
          await redis.set(`presence:user:${userId}:lastActive`, String(now), "EX", 60 * 60 * 24 * 365);
          const un = await redis.get(`presence:user:${userId}:name`);
          if (un) io.to(`presence:${un}`).emit("presence:offline", { username: un, lastActiveAt: now });
          await redis.del(`presence:user:${userId}`);
          await redis.del(`presence:user:${userId}:name`);
        }
        await redis.del(`socket:${socket.id}:identity`);
        await redis.del(`socket:${socket.id}:name`);
        await redis.del(`queue:member:${socket.id}`);
      } catch {
      }
    });
  });
}
