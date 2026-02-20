import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, index: true },
    email: { type: String, unique: true, sparse: true, index: true },
    passwordHash: { type: String, required: true },
    country: { type: String, default: "TR" }
  },
  { timestamps: true }
);

export const User = mongoose.model("User", UserSchema);

