import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const envPath = path.resolve(fileURLToPath(new URL("../../backend/.env", import.meta.url)));
dotenv.config({ path: envPath });

import { io } from "socket.io-client";

import { connectDb } from "../../backend/api/src/config/db.js";
import { redis } from "../../backend/api/src/config/redis.js";
import { User } from "../../backend/api/src/models/User.js";
import { UserRating } from "../../backend/api/src/models/UserRating.js";
import { signToken } from "../../backend/api/src/auth/jwt.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitOnce(socket, event, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting ${event}`));
    }, timeoutMs);
    const onEvent = (payload) => {
      cleanup();
      resolve(payload);
    };
    const cleanup = () => {
      clearTimeout(t);
      socket.off(event, onEvent);
    };
    socket.on(event, onEvent);
  });
}

async function main() {
  await connectDb();
  await redis.ping();

  const ts = Date.now();
  const a = await User.create({ username: `mm_a_${ts}`, passwordHash: "x" });
  const b = await User.create({ username: `mm_b_${ts}`, passwordHash: "x" });
  const c = await User.create({ username: `mm_c_${ts}`, passwordHash: "x" });

  const sockets = [];
  try {
    await UserRating.create({ userId: String(a._id), speed: "blitz", rating: 1100, rd: 80, vol: 0.06, games: 20, provisional: false });
    await UserRating.create({ userId: String(b._id), speed: "blitz", rating: 1900, rd: 80, vol: 0.06, games: 20, provisional: false });
    await UserRating.create({ userId: String(c._id), speed: "blitz", rating: 1850, rd: 80, vol: 0.06, games: 20, provisional: false });

    const tokenA = signToken({ userId: String(a._id), username: a.username });
    const tokenB = signToken({ userId: String(b._id), username: b.username });
    const tokenC = signToken({ userId: String(c._id), username: c.username });

    const sA = io("http://localhost:4000", { transports: ["websocket"], auth: { token: tokenA } });
    const sB = io("http://localhost:4000", { transports: ["websocket"], auth: { token: tokenB } });
    const sC = io("http://localhost:4000", { transports: ["websocket"], auth: { token: tokenC } });
    sockets.push(sA, sB, sC);

    for (const [name, s] of [
      ["A", sA],
      ["B", sB],
      ["C", sC],
    ]) {
      s.on("queue:waiting", (p) => console.log(name, "waiting", p));
      s.on("queue:blocked", (p) => console.log(name, "blocked", p));
      s.on("queue:matched", (p) => console.log(name, "matched(event)", p));
    }

    await Promise.all([
      waitOnce(sA, "connect", 10_000),
      waitOnce(sB, "connect", 10_000),
      waitOnce(sC, "connect", 10_000),
    ]);

    // A and B are too far apart initially -> should wait (no match)
    sA.emit("queue:join", { initial: 5, increment: 0 });
    sB.emit("queue:join", { initial: 5, increment: 0 });

    await sleep(1200);

    // Prepare listeners BEFORE join to avoid missing fast match
    const pB = waitOnce(sB, "queue:matched", 10_000);
    const pC = waitOnce(sC, "queue:matched", 10_000);

    // Now add C close to B -> should match quickly
    sC.emit("queue:join", { initial: 5, increment: 0 });

    const [mB, mC] = await Promise.all([pB, pC]);
    console.log("B matched", mB);
    console.log("C matched", mC);
  } finally {
    for (const s of sockets) s.disconnect();
    await User.deleteMany({ _id: { $in: [a._id, b._id, c._id] } });
    await UserRating.deleteMany({ userId: { $in: [String(a._id), String(b._id), String(c._id)] } });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

