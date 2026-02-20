import mongoose from "mongoose";

export async function connectDb() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.warn("⚠️ MONGO_URI yok. Oyunlar MongoDB'ye kaydedilmeyecek.");
    return;
  }

  await mongoose.connect(uri);
  console.log("✅ MongoDB connected");
}
