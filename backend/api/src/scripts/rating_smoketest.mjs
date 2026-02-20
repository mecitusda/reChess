import dotenv from "dotenv";
dotenv.config();

import { connectDb } from "../config/db.js";
import { redis } from "../config/redis.js";
import { User } from "../models/User.js";
import { UserRating } from "../models/UserRating.js";
import { applyRatedGameResult } from "../services/rating.service.js";

async function main() {
  await connectDb();
  console.log("mongo ok");
  try {
    await redis.ping();
    console.log("redis ok");
  } catch (e) {
    console.error("redis ping failed", e);
    return;
  }

  const uA = `rtesta_${Date.now()}`;
  const uB = `rtestb_${Date.now()}`;

  console.log("creating users", uA, uB);
  const a = await User.create({ username: uA, passwordHash: "x" });
  const b = await User.create({ username: uB, passwordHash: "x" });
  console.log("users ok", String(a._id), String(b._id));

  const mkGame = (id, winner) => ({
    gameId: id,
    state: "FINISHED",
    rated: true,
    initialMs: 5 * 60 * 1000,
    incrementMs: 0,
    finishReason: "checkmate",
    winner,
    whiteIdentity: `user:${String(a._id)}`,
    blackIdentity: `user:${String(b._id)}`,
  });

  const g1 = mkGame(`g1_${Date.now()}`, "white");
  console.log("g1 id", g1.gameId);
  console.log("apply g1", await applyRatedGameResult(g1));
  console.log("apply g1 again", await applyRatedGameResult(g1));

  const ra1 = await UserRating.findOne({ userId: String(a._id), speed: "blitz" }).lean();
  const rb1 = await UserRating.findOne({ userId: String(b._id), speed: "blitz" }).lean();
  console.log("A blitz", ra1?.rating, ra1?.rd, ra1?.games, ra1?.provisional);
  console.log("B blitz", rb1?.rating, rb1?.rd, rb1?.games, rb1?.provisional);

  const g2 = mkGame(`g2_${Date.now()}`, "black");
  console.log("g2 id", g2.gameId);
  console.log("apply g2", await applyRatedGameResult(g2));

  const ra2 = await UserRating.findOne({ userId: String(a._id), speed: "blitz" }).lean();
  const rb2 = await UserRating.findOne({ userId: String(b._id), speed: "blitz" }).lean();
  console.log("A blitz2", ra2?.rating, ra2?.rd, ra2?.games, ra2?.provisional);
  console.log("B blitz2", rb2?.rating, rb2?.rd, rb2?.games, rb2?.provisional);

  await User.deleteMany({ _id: { $in: [a._id, b._id] } });
  await UserRating.deleteMany({ userId: { $in: [String(a._id), String(b._id)] } });
  await redis.del(`game:${g1.gameId}`);
  await redis.del(`game:${g2.gameId}`);

  try {
    await redis.quit();
  } catch {
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

