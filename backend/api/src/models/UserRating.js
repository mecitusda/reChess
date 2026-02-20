import mongoose from "mongoose";

const UserRatingSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    speed: { type: String, required: true, enum: ["bullet", "blitz", "rapid", "classical"] },

    rating: { type: Number, required: true }, 
    rd: { type: Number, required: true }, 
    vol: { type: Number, required: true }, 
    games: { type: Number, default: 0 },
    provisional: { type: Boolean, default: true },
  },
  { timestamps: true }
);

UserRatingSchema.index({ userId: 1, speed: 1 }, { unique: true });

export const UserRating = mongoose.model("UserRating", UserRatingSchema);

