import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { redis } from "../config/redis.js";
import { signToken, verifyToken } from "../auth/jwt.js";
import { User } from "../models/User.js";
import { sendPasswordResetCodeEmail } from "../services/mailer.js";
import geoip from "geoip-lite";



export const authRouter = express.Router();

function getCountryFromIp(ip) {
  const geo = geoip.lookup(ip);
  return geo?.country || "TR";
}

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function makeResetCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashResetCode(code) {
  const pepper = String(process.env.PWD_RESET_SECRET || "pwdreset");
  return crypto.createHash("sha256").update(`${pepper}:${code}`).digest("hex");
}

function getBearerToken(req) {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m?.[1] ?? null;
}

async function resolveIdentityFromRequest(req) {
  const token = getBearerToken(req);
  if (token) {
    try {
      const payload = verifyToken(token);
      if (payload?.userId) return `user:${payload.userId}`;
    } catch {
    }
  }
  const guestId = String(req.headers["x-guest-id"] || "").trim();
  if (guestId) return `guest:${guestId}`;
  return null;
}

async function migrateGuestActiveGameToUser({ guestId, userId, username }) {
  const gid = String(guestId || "").trim();
  if (!gid) return;

  const guestIdentity = `guest:${gid}`;
  const userIdentity = `user:${userId}`;

  const gameId = await redis.get(`activeGame:${guestIdentity}`);
  if (!gameId) return;

  const game = await redis.hgetall(`game:${gameId}`);
  if (!game?.fen || game.state === "FINISHED") {
    await redis.del(`activeGame:${guestIdentity}`);
    await redis.zrem(`activeGamesZ:${guestIdentity}`, gameId);
    return;
  }

  await redis.set(`identity:${userIdentity}:name`, username, "EX", 60 * 60 * 24 * 30);

  if (game.whiteIdentity === guestIdentity) {
    await redis.hset(`game:${gameId}`, { whiteIdentity: userIdentity, whiteName: username });
  }
  if (game.blackIdentity === guestIdentity) {
    await redis.hset(`game:${gameId}`, { blackIdentity: userIdentity, blackName: username });
  }

  await redis.set(`activeGame:${userIdentity}`, gameId, "EX", 60 * 60 * 6);
  await redis.zadd(`activeGamesZ:${userIdentity}`, Date.now(), gameId);
  await redis.expire(`activeGamesZ:${userIdentity}`, 60 * 60 * 24 * 7);

  await redis.del(`activeGame:${guestIdentity}`);
  await redis.zrem(`activeGamesZ:${guestIdentity}`, gameId);
}

authRouter.post("/register", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const emailRaw = req.body?.email;
  const email = emailRaw ? normalizeEmail(emailRaw) : "";
  const password = String(req.body?.password || "");
  const ip =
  req.headers["x-forwarded-for"]?.toString().split(",")[0] ||
  req.socket.remoteAddress;
  const country = getCountryFromIp(ip);
  if (username.length < 3) return res.status(400).json({ ok: false, error: "USERNAME_TOO_SHORT" });
  if (email && !isValidEmail(email)) return res.status(400).json({ ok: false, error: "EMAIL_INVALID" });
  if (password.length < 6) return res.status(400).json({ ok: false, error: "PASSWORD_TOO_SHORT" });

  const passwordHash = await bcrypt.hash(password, 10);

  const exists = await User.findOne({ username }).lean();
  if (exists) return res.status(409).json({ ok: false, error: "USERNAME_TAKEN" });

  if (email) {
    const emailExists = await User.findOne({ email }).lean();
    if (emailExists) return res.status(409).json({ ok: false, error: "EMAIL_TAKEN" });
  }

  const user = await User.create({ username, passwordHash, country, ...(email ? { email } : {}) });
  const userId = String(user._id);

  await migrateGuestActiveGameToUser({
    guestId: req.headers["x-guest-id"],
    userId,
    username,
  });

  const token = signToken({ userId, username });
  return res.json({ ok: true, data: { userId, username, token } });
});

authRouter.post("/password-reset/request", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: "EMAIL_INVALID" });
    }

    const rlKey = `pwdreset:rl:${email}`;
    const sentKey = `pwdreset:sent:${email}`;
    const ttlSec = 60 * 2;

    const rl = await redis.get(rlKey);
    if (rl) {
      const retryAfterSec = Math.max(0, Number(await redis.ttl(rlKey)));
      const expiresInSec = Math.max(0, Number(await redis.ttl(sentKey)));
      return res.json({
        ok: true,
        data: { rateLimited: true, retryAfterSec, expiresInSec },
      });
    }
    await redis.set(rlKey, "1", "EX", 45);
    await redis.set(sentKey, "1", "EX", ttlSec);

    const user = await User.findOne({ email }).lean();
    if (!user?._id) return res.json({ ok: true, data: { rateLimited: false, retryAfterSec: 0, expiresInSec: ttlSec } });

    const userId = String(user._id);
    const code = makeResetCode();

    await redis.set(`pwdreset:code:${userId}`, hashResetCode(code), "EX", ttlSec);
    await redis.set(`pwdreset:email:${userId}`, email, "EX", ttlSec);
    await redis.set(`pwdreset:tries:${userId}`, "0", "EX", ttlSec);

    await sendPasswordResetCodeEmail({ to: email, code, minutesValid: 2 });
    return res.json({ ok: true, data: { rateLimited: false, retryAfterSec: 0, expiresInSec: ttlSec } });
  } catch (e) {
    console.error("[password-reset/request] error", e);
    return res.status(500).json({ ok: false, error: "INTERNAL" });
  }
});

authRouter.post("/password-reset/confirm", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    if (!email || !isValidEmail(email)) return res.status(400).json({ ok: false, error: "EMAIL_INVALID" });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: "CODE_INVALID" });
    if (newPassword.length < 6) return res.status(400).json({ ok: false, error: "PASSWORD_TOO_SHORT" });

    const user = await User.findOne({ email }).lean();
    if (!user?._id) return res.status(400).json({ ok: false, error: "CODE_INVALID" });

    const userId = String(user._id);
    const storedEmail = await redis.get(`pwdreset:email:${userId}`);
    const storedHash = await redis.get(`pwdreset:code:${userId}`);
    if (!storedEmail || !storedHash || storedEmail !== email) {
      return res.status(400).json({ ok: false, error: "CODE_EXPIRED" });
    }

    const triesKey = `pwdreset:tries:${userId}`;
    const tries = Number((await redis.get(triesKey)) || "0");
    if (tries >= 6) return res.status(429).json({ ok: false, error: "TOO_MANY_TRIES" });

    if (hashResetCode(code) !== storedHash) {
      await redis.set(triesKey, String(tries + 1), "EX", 60 * 2);
      return res.status(400).json({ ok: false, error: "CODE_INVALID" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await User.updateOne({ _id: userId }, { $set: { passwordHash } });

    await redis.del(`pwdreset:code:${userId}`);
    await redis.del(`pwdreset:email:${userId}`);
    await redis.del(`pwdreset:tries:${userId}`);

    return res.json({ ok: true });
  } catch (e) {
    console.error("[password-reset/confirm] error", e);
    return res.status(500).json({ ok: false, error: "INTERNAL" });
  }
});

authRouter.post("/login", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");
  const user = await User.findOne({ username }).lean();
  if (!user?.passwordHash) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });

  const userId = String(user._id);

  await migrateGuestActiveGameToUser({
    guestId: req.headers["x-guest-id"],
    userId,
    username: user.username,
  });

  const token = signToken({ userId, username: user.username });
  return res.json({ ok: true, data: { userId, username: user.username, token } });
});

authRouter.get("/me", async (req, res) => {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "NO_TOKEN" });

  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.userId).lean();
    if (!user?._id) return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
    return res.json({ ok: true, data: { userId: String(user._id), username: user.username } });
  } catch {
    return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
  }
});

authRouter.get("/active-game", async (req, res) => {
  const identityKey = await resolveIdentityFromRequest(req);
  if (!identityKey) return res.json({ ok: true, data: { gameId: null } });

  async function validateGameId(gameId) {
    if (!gameId) return null;
    const game = await redis.hgetall(`game:${gameId}`);
    if (!game?.fen || game.state === "FINISHED") return null;
    return gameId;
  }

  const pointer = await validateGameId(await redis.get(`activeGame:${identityKey}`));
  if (pointer) return res.json({ ok: true, data: { gameId: pointer } });

  await redis.del(`activeGame:${identityKey}`);

  const zKey = `activeGamesZ:${identityKey}`;
  const recent = await redis.zrevrange(zKey, 0, 10);
  for (const gid of recent) {
    const ok = await validateGameId(gid);
    if (ok) {
      await redis.set(`activeGame:${identityKey}`, ok, "EX", 60 * 60 * 6);
      return res.json({ ok: true, data: { gameId: ok } });
    }
    await redis.zrem(zKey, gid);
  }

  return res.json({ ok: true, data: { gameId: null } });
});

