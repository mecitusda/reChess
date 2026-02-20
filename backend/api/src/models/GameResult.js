import mongoose from "mongoose";

const MoveSchema = new mongoose.Schema(
  {
    ply: Number,
    from: String,
    to: String,
    san: String,
    fen: String,
    at: Number, 
  },
  { _id: false }
);

const GameResultSchema = new mongoose.Schema(
  {
    gameId: { type: String, required: true, unique: true, index: true },

    status: { type: String, enum: ["finished"], default: "finished" },

    whiteSocketId: { type: String, default: "" },
    blackSocketId: { type: String, default: "" },

    whiteIdentity: { type: String, default: "" },
    blackIdentity: { type: String, default: "" },

    whiteUserId: { type: String, default: "" },
    blackUserId: { type: String, default: "" },
    whiteName: { type: String, default: "" },
    blackName: { type: String, default: "" },

    initialMs: { type: Number, default: 0 },
    incrementMs: { type: Number, default: 0 },
    rated: { type: Boolean, default: false },

    winner: { type: String, enum: ["white", "black", "draw"], default: null },
    reason: {
      type: String,
      enum: [
        "checkmate",
        "timeout",
        "resign",
        "draw",
        "draw_agreed",
        "aborted",            
        "disconnect_timeout", 
      ],
      required: true,
      },

    finalFen: { type: String, required: true },

    whiteTime: { type: Number, default: 0 },
    blackTime: { type: Number, default: 0 },

    moves: { type: [MoveSchema], default: [] },
    pgn: { type: String, default: "" },
  },
  { timestamps: true }
);

export const GameResult = mongoose.model("GameResult", GameResultSchema);
