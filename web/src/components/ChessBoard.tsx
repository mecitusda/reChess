import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import { useState } from "react";
import type { PieceDropHandlerArgs } from "react-chessboard";

export default function ChessBoard() {
  const [game, setGame] = useState(new Chess());

  const chessboardOptions = {
    position: game.fen(),

    onPieceDrop: ({
  sourceSquare,
  targetSquare,
}: PieceDropHandlerArgs): boolean => {

  if (!targetSquare) return false; 

  const move = game.move({
    from: sourceSquare,
    to: targetSquare,
    promotion: "q",
  });

  if (move === null) return false;

  setGame(new Chess(game.fen()));
  return true;
    },

  };

  return <Chessboard options={chessboardOptions} />;
}
