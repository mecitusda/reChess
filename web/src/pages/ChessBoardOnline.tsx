import { useEffect, useMemo, useState, memo } from "react";
import { Chessboard, defaultPieces } from "react-chessboard";
import { Chess } from "chess.js";
import type { Square, Move } from "chess.js";
import type {
  SquareHandlerArgs,
  PieceHandlerArgs,
  PieceDropHandlerArgs,
} from "react-chessboard";
import { socket } from "../socket/socket";
type Props = {
  gameId: string;
  fen: string;
  turn: "w" | "b";
  status: "waiting" | "active" | "finished";
  myColor: "w" | "b" | null;
  lastMove?: { from: Square; to: Square } | null;
  isReplay?: boolean;
};

function ChessBoardOnline({
  gameId,
  fen,
  turn,
  status,
  myColor,
  lastMove,
  isReplay
}: Props) {

 
  const [localFen, setLocalFen] = useState(fen);
  useEffect(() => setLocalFen(fen), [fen]);
  const effectiveFen = isReplay ? fen : localFen;

  const chess = useMemo(() => new Chess(effectiveFen), [effectiveFen]);

  /** Hamleyi hemen tahtada göster (sunucu yanıtını beklemeden). Sunucudan game:state gelince fen prop güncellenir. */
  function applyOptimisticMove(from: Square, to: Square, promotion?: PromotionPiece) {
    const c = new Chess(effectiveFen);
    const ok = c.move({ from, to, promotion: promotion ?? "q" });
    if (ok) setLocalFen(c.fen());
  }
  const [checkStyles, setCheckStyles] = useState<
    Record<string, React.CSSProperties>
  >({});
  
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [premoveFromSquare, setPremoveFromSquare] = useState<Square | null>(
    null
  );

  const [premoveIntentTo, setPremoveIntentTo] = useState<Square | null>(null);

  const [legalStyles, setLegalStyles] = useState<
    Record<string, React.CSSProperties>
  >({});
  const [lastMoveStyles, setLastMoveStyles] = useState<
    Record<string, React.CSSProperties>
  >({});

  const [preMove, setPreMove] = useState<{
    from: Square;
    to: Square;
    isCapture: boolean;
    promotion?: "q" | "r" | "b" | "n";
  } | null>(null);

  const [pendingPromotion, setPendingPromotion] = useState<{
    from: Square;
    to: Square;
  } | null>(null);
  const [pendingPreMovePromotion, setPendingPreMovePromotion] = useState<{
    from: Square;
    to: Square;
    isCapture: boolean;
  } | null>(null);

  const [preMoveStyles, setPreMoveStyles] = useState<
    Record<string, React.CSSProperties>
  >({});

  const [preMoveLegalStyles, setPreMoveLegalStyles] = useState<
  Record<string, React.CSSProperties>
>({});

  
  const squareStyles = useMemo(
  () => ({
    ...lastMoveStyles,
    ...checkStyles,          
    ...legalStyles,          
    ...preMoveLegalStyles,
    ...preMoveStyles,
  }),
  [lastMoveStyles, checkStyles, legalStyles, preMoveLegalStyles, preMoveStyles]
);
  const canMove =
    !isReplay &&
    !!myColor &&
    turn === myColor &&
    (status === "active" || status === "waiting");

  function clearPreMoveSelection() {
    setPremoveFromSquare(null);
    setPremoveIntentTo(null);
    setPreMoveLegalStyles({});
  }

  function clearQueuedPreMove() {
    setPreMove(null);
    setPreMoveStyles({});
  }
  function isCapture(move: Move) {
  return move.flags.includes("c") || move.flags.includes("e");
}

  type PromotionPiece = "q" | "r" | "b" | "n";
  function isPromotionMove(myColor: "w" | "b", from: Square, to: Square): boolean {
    return (
      (myColor === "w" && from[1] === "7" && to[1] === "8") ||
      (myColor === "b" && from[1] === "2" && to[1] === "1")
    );
  }

const moveDotBg = (rgba: string) =>
  `radial-gradient(circle, ${rgba} 20%, transparent 21%)`;


const moveCaptureBg = (ring: string) =>
  `radial-gradient(circle,
    transparent 0 30%,
    rgba(0, 0, 0, 0) 75% 34%,
    ${ring} 35% 100%,
    transparent 57%
  )`; 

function buildLegalStyles(
  chess: Chess,
  from: Square
): Record<string, React.CSSProperties> {
  const styles: Record<string, React.CSSProperties> = {};
  const piece = chess.get(from);

  const moves = chess.moves({ square: from, verbose: true }) as Move[];

  moves.forEach((m) => {
    const isCastle = m.flags.includes("k") || m.flags.includes("q");


    if (piece?.type === "k") {

      if (isCastle) {
        styles[m.to] = {
          background: "rgba(34,197,94,0.45)",
          cursor: "pointer",
        };
        return;
      }


      const target = chess.get(m.to);
      if (target && target.color !== piece.color) {
        styles[m.to] = {
          background: moveCaptureBg("rgba(34,197,94,0.78)"),
          cursor: "pointer",
        };
        return;
      }

      styles[m.to] = {
        background: moveDotBg("rgba(34,197,94,0.9)"),
        cursor: "pointer",
      };
      return;
    }

    if (isCastle) {
      styles[m.to] = {
        background: "rgba(34,197,94,0.45)",
        cursor: "pointer",
      };
      return;
    }

    if (isCapture(m)) {
      styles[m.to] = {
        background: moveCaptureBg("rgba(34,197,94,0.78)"),
        cursor: "pointer",
      };
    } else {
      styles[m.to] = {
        background: moveDotBg("rgba(34,197,94,0.9)"),
        cursor: "pointer",
      };
    }
  });

  styles[from] = { background: "rgba(34,197,94,0.25)" };
  return styles;
}




  function getPreMoveLegalTargets(
  fen: string,
  from: Square,
  myColor: "w" | "b"
): { to: Square; isOccupied: boolean; kind: "move" | "capture" | "castle" }[] {


  const base = new Chess(fen);
  const out = new Map<Square, { isOccupied: boolean; kind: "move" | "capture" | "castle" }>();

  const fenParts = fen.split(" ");
  const myFen =
    fenParts.length >= 2
      ? (() => {
          const p = [...fenParts];
          p[1] = myColor;
          return p.join(" ");
        })()
      : fen;
  const myPos = new Chess(myFen);
  const myPiece = myPos.get(from);
  if (myPiece && myPiece.color === myColor) {
    const myMovesNow = myPos.moves({ square: from, verbose: true }) as Move[];
    myMovesNow.forEach((m) => {
      const capture = m.flags.includes("c") || m.flags.includes("e");
      const castle = m.flags.includes("k") || m.flags.includes("q");
      const t = base.get(m.to);
      const occupiedNowByOpponent = !!t && t.color !== myColor;
      out.set(m.to as Square, {
        isOccupied: capture || occupiedNowByOpponent,
        kind: castle ? "castle" : capture ? "capture" : "move",
      });
    });
  }

  const oppMoves = base.moves({ verbose: true }) as Move[];
  oppMoves.forEach((opp) => {
    const isCap = opp.flags.includes("c") || opp.flags.includes("e");
    if (!isCap) return;

    const landing = opp.to as Square;
    const victim = base.get(landing);
    if (!victim || victim.color !== myColor) return; 

    const sim = new Chess(fen);
    try {
      sim.move(opp);
    } catch {
      return;
    }

    const pieceAfter = sim.get(from);
    if (!pieceAfter || pieceAfter.color !== myColor) return;

    const myMovesAfter = sim.moves({ square: from, verbose: true }) as Move[];
    const canRecapture = myMovesAfter.some(
      (m) => m.to === landing && (m.flags.includes("c") || m.flags.includes("e"))
    );
    if (canRecapture) {
      out.set(landing, { isOccupied: true, kind: "capture" });
    }
  });

  return Array.from(out.entries()).map(([to, v]) => ({
    to,
    isOccupied: v.isOccupied,
    kind: v.kind,
  }));
}




  function buildPreMoveStyle(
  from: Square,
  to: Square,
  _isCapture: boolean
): Record<string, React.CSSProperties> {
  void _isCapture;
  const fillFrom = "rgba(37,99,235,0.38)"; 
  const fillTo = "rgba(37,99,235,0.46)";
  return {
    [from]: { background: fillFrom },
    [to]: { background: fillTo },
  };
}


function buildPreMoveLegalStyles(
  targets: { to: Square; isOccupied: boolean; kind: "move" | "capture" | "castle" }[],
  from: Square
) {
  const styles: Record<string, React.CSSProperties> = {};

  targets.forEach((t) => {
    if (t.kind === "castle") {
      styles[t.to] = {
        background: "rgba(59,130,246,0.38)",
        cursor: "pointer",
      };
      return;
    }

    styles[t.to] = t.isOccupied
      ? {
          background: moveCaptureBg("rgba(59,130,246,0.85)"),
          cursor: "pointer",
        }
      : {
          background: moveDotBg("rgba(59,130,246,0.9)"),
          cursor: "pointer",
        };
  });

  styles[from] = { background: "rgba(59,130,246,0.35)" };
  return styles;
}

  useEffect(() => {
  if (!isReplay) return;
  
  setSelectedSquare(null);
  setLegalStyles({});
  clearQueuedPreMove();
  clearPreMoveSelection();
}, [isReplay, fen]);

  useEffect(() => {
    if (isReplay) return;
    if (!myColor) return;

    const tmp = new Chess(fen);

    if (premoveIntentTo) {
      const p = tmp.get(premoveIntentTo);
      if (!p || p.color === myColor) {
        setPremoveIntentTo(null);
      }
    }

    if (premoveFromSquare) {
      const targets = getPreMoveLegalTargets(fen, premoveFromSquare, myColor);
      if (!targets.length) {
        setPremoveFromSquare(null);
        setPreMoveLegalStyles({});
      } else {
        setPreMoveLegalStyles(buildPreMoveLegalStyles(targets, premoveFromSquare));
      }
      return;
    }

    if (!preMove) {
      setPreMoveLegalStyles({});
    }
  }, [fen, isReplay, myColor, premoveFromSquare, premoveIntentTo, preMove]);

  useEffect(() => {
    if (isReplay) return;
    if (!myColor) return;
    if (!canMove) return; 
    if (!premoveFromSquare && !premoveIntentTo) return;
    clearPreMoveSelection();
  }, [fen, canMove, isReplay, myColor, premoveFromSquare, premoveIntentTo]);

  useEffect(() => {
    const tmp = new Chess(fen);

    if (!tmp.inCheck()) {
      setCheckStyles({});
      return;
    }

    const board = tmp.board();
    let kingSquare: Square | null = null;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.type === "k" && p.color === tmp.turn()) {
          kingSquare = (`abcdefgh`[c] + (8 - r)) as Square;
        }
      }
    }

    if (kingSquare) {
      setCheckStyles({
        [kingSquare]: {
          background: "rgba(239,68,68,0.7)", // 🔴 kırmızı
        },
      });
    }
  }, [fen]);

  useEffect(() => {
  if (!lastMove) {
    setLastMoveStyles({});
    return;
  }

  setLastMoveStyles({
    [lastMove.from]: { background: "rgba(250,204,21,0.6)" },
    [lastMove.to]: { background: "rgba(250,204,21,0.6)" },
  });
}, [lastMove]);

  useEffect(() => {
  if (!preMove) return;
  if (isReplay) return;

  const itsMyTurnNow = status !== "finished" && myColor != null && turn === myColor;
  if (!itsMyTurnNow) return;

  const tmp = new Chess(fen);
  const promo = preMove.promotion ?? "q";
  let ok = false;
  try {
    ok = !!tmp.move({ from: preMove.from, to: preMove.to, promotion: promo });
  } catch { ok = false; }

  if (ok) {
    const t = setTimeout(() => {
      socket.emit(
        "game:move",
        { gameId, from: preMove.from, to: preMove.to, promotion: promo },
        () => {
          clearQueuedPreMove();
          clearPreMoveSelection();
          setSelectedSquare(null);
          setLegalStyles({});
        }
      );
    }, 50);
    return () => clearTimeout(t);
  }

  clearQueuedPreMove();
}, [fen, turn, status, myColor, preMove, gameId, isReplay]);


  useEffect(() => {
    if (!selectedSquare) {
      setLegalStyles({});
    }
  }, [fen, selectedSquare]);


  useEffect(() => {
    if (status !== "finished") return;
    setSelectedSquare(null);
    setLegalStyles({});
    clearQueuedPreMove();
    clearPreMoveSelection();
  }, [status]);

  
function onSquareClick({ square }: SquareHandlerArgs) {
  if (!square || isReplay) return;
  if (status === "finished") return;
  const sq = square as Square;

  // PREMOVE
  if (!canMove) {
    if (!myColor) return;

    const clickedPiece = chess.get(sq);

    if (preMove && sq === preMove.from) {
      clearQueuedPreMove();
      clearPreMoveSelection();
      return;
    }

    if (preMove && sq !== preMove.from) {
      clearQueuedPreMove();
    }

    if (premoveFromSquare) {

      if (sq === premoveFromSquare) {
        const targets = getPreMoveLegalTargets(fen, premoveFromSquare, myColor);
        if (!targets.length) {
          clearPreMoveSelection();
        } else {
          setPreMoveLegalStyles(buildPreMoveLegalStyles(targets, premoveFromSquare));
        }
        return;
      }


      const targets = getPreMoveLegalTargets(fen, premoveFromSquare, myColor);
      const t = targets.find((x) => x.to === sq);
      if (t) {
        if (isPromotionMove(myColor, premoveFromSquare, sq)) {
          setPendingPreMovePromotion({
            from: premoveFromSquare,
            to: sq,
            isCapture: t.isOccupied,
          });
          setPreMoveStyles(buildPreMoveStyle(premoveFromSquare, sq, t.isOccupied));
          clearPreMoveSelection();
          return;
        }
        setPreMove({
          from: premoveFromSquare,
          to: sq,
          isCapture: t.isOccupied,
        });
        setPreMoveStyles(buildPreMoveStyle(premoveFromSquare, sq, t.isOccupied));
        clearPreMoveSelection();
        return;
      }

      if (clickedPiece && clickedPiece.color === myColor) {
       
      }
    
    }

    if (!premoveFromSquare && clickedPiece && clickedPiece.color !== myColor) {
      setPremoveIntentTo(sq);
      return;
    }

   
    if (clickedPiece && clickedPiece.color === myColor) {
      
      clearQueuedPreMove();

      
      if (premoveIntentTo) {
        const targets = getPreMoveLegalTargets(fen, sq, myColor);
        const t = targets.find((x) => x.to === premoveIntentTo);
        if (t) {
          if (isPromotionMove(myColor, sq, premoveIntentTo)) {
            setPendingPreMovePromotion({
              from: sq,
              to: premoveIntentTo,
              isCapture: t.isOccupied,
            });
            setPreMoveStyles(buildPreMoveStyle(sq, premoveIntentTo, t.isOccupied));
            clearPreMoveSelection();
            setSelectedSquare(null);
            setLegalStyles({});
            return;
          }
          setPreMove({ from: sq, to: premoveIntentTo, isCapture: t.isOccupied });
          setPreMoveStyles(buildPreMoveStyle(sq, premoveIntentTo, t.isOccupied));
          clearPreMoveSelection();
          setSelectedSquare(null);
          setLegalStyles({});
          return;
        }
       
        setPremoveIntentTo(null);
      }

      
      setPremoveFromSquare(sq);
      const targets = getPreMoveLegalTargets(fen, sq, myColor);
      if (!targets.length) {
        clearPreMoveSelection();
        return;
      }
      setPreMoveLegalStyles(buildPreMoveLegalStyles(targets, sq));
      return;
    }

    
    setPremoveFromSquare(null);
    setPreMoveLegalStyles({});
    setPremoveIntentTo(null);
    return;
  }

  //  NORMAL MOVE 
  if (!myColor) return;

  const clickedPiece = chess.get(sq);

  if (selectedSquare) {
    const moves = chess.moves({ square: selectedSquare, verbose: true }) as Move[];
    const legal = moves.find((m) => m.to === sq);

    if (legal) {
      const isPromo = legal.flags?.includes("p");
      if (isPromo) {
        setPendingPromotion({ from: selectedSquare, to: sq });
        setSelectedSquare(null);
        setLegalStyles({});
        return;
      }
      socket.emit("game:move", { gameId, from: selectedSquare, to: sq, promotion: "q" });
      applyOptimisticMove(selectedSquare, sq);
      setSelectedSquare(null);
      setLegalStyles({});
      return;
    }

    if (clickedPiece && clickedPiece.color === myColor) {
      setSelectedSquare(sq);
      setLegalStyles(buildLegalStyles(chess, sq));
      return;
    }

    setSelectedSquare(null);
    setLegalStyles({});
    return;
  }

  if (!clickedPiece || clickedPiece.color !== myColor) {
    setSelectedSquare(null);
    setLegalStyles({});
    return;
  }

  setSelectedSquare(sq);
  setLegalStyles(buildLegalStyles(chess, sq));
}









 
  function onPieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs) {
  if (!sourceSquare || !targetSquare) return false;
  if (isReplay) return false;
  if (status === "finished") return false;

  if (sourceSquare === targetSquare) {
    setSelectedSquare(null);
    setPreMove(null);
    setPreMoveStyles({});
    setPreMoveLegalStyles({});
    return false;
  }

  setSelectedSquare(null);
  setLegalStyles({});

  //  NORMAL MOVE
  if (canMove) {
    if (myColor && isPromotionMove(myColor, sourceSquare as Square, targetSquare as Square)) {
      setPendingPromotion({ from: sourceSquare as Square, to: targetSquare as Square });
      return false;
    }
    socket.emit("game:move", {
      gameId,
      from: sourceSquare,
      to: targetSquare,
      promotion: "q",
    });
    applyOptimisticMove(sourceSquare as Square, targetSquare as Square);
    return false;
  }

  // PREMOVE
  if (!myColor) return false;
  
  const from = sourceSquare as Square;
  const to = targetSquare as Square;


  const targets = getPreMoveLegalTargets(fen, from, myColor);
  const target = targets.find((t) => t.to === to);
  if (!target) {
    clearPreMoveSelection();
    return false;
  }

  if (isPromotionMove(myColor, from, to)) {
    setPendingPreMovePromotion({ from, to, isCapture: target.isOccupied });
    setPreMoveStyles(buildPreMoveStyle(from, to, target.isOccupied));
    clearPreMoveSelection();
    return false;
  }

  clearQueuedPreMove();
  setPreMove({ from, to, isCapture: target.isOccupied });
  setPreMoveStyles(buildPreMoveStyle(from, to, target.isOccupied));
  clearPreMoveSelection();

  return false; 
}




  function onPieceDrag({ square }: PieceHandlerArgs) {
  if (!square) return;
  if (isReplay) return;
  if (!myColor) return;
  if (status === "finished") return;

  const sq = square as Square;
  const piece = chess.get(sq);

  
  if (!piece || piece.color !== myColor) return;

  // NORMAL MOVE
  if (canMove) {
    setSelectedSquare(sq);
    setLegalStyles(buildLegalStyles(chess, sq));
    return;
  }

  // PREMOVE 
  clearQueuedPreMove();
  setPremoveIntentTo(null);

  const targets = getPreMoveLegalTargets(fen, sq, myColor);
  if (!targets.length) return;

  setPremoveFromSquare(sq);
  setPreMoveLegalStyles(buildPreMoveLegalStyles(targets, sq));
}


useEffect(() => {
  if (isReplay) return;

  setSelectedSquare(null);
  setLegalStyles({});
}, [fen, isReplay]);


  // ORIENTATION 
  const orientation: "white" | "black" =
    myColor === "b" ? "black" : "white";
 
  const allowDrag = !isReplay && !!myColor && status !== "finished";

  const promotionPieces: { piece: PromotionPiece; label: string; pieceKey: keyof typeof defaultPieces }[] = [
    { piece: "q", label: "Vezir", pieceKey: myColor === "w" ? "wQ" : "bQ" },
    { piece: "r", label: "Kale", pieceKey: myColor === "w" ? "wR" : "bR" },
    { piece: "b", label: "Fil", pieceKey: myColor === "w" ? "wB" : "bB" },
    { piece: "n", label: "At", pieceKey: myColor === "w" ? "wN" : "bN" },
  ];

  // RENDER
  return (
    <div className="board-container">
    {(pendingPromotion || pendingPreMovePromotion) && myColor && (
      <div className="promotionOverlay" role="dialog" aria-label="Terfi taşı seç">
        <div className="promotionDialog">
          <p className="promotionDialog__title">Taş seç</p>
          <div className="promotionDialog__pieces">
            {promotionPieces.map(({ piece, label, pieceKey }) => {
              const PieceSvg = defaultPieces[pieceKey];
              return (
                <button
                  key={piece}
                  type="button"
                  className="promotionDialog__btn"
                  onClick={() => {
                    if (pendingPromotion) {
                      socket.emit("game:move", {
                        gameId,
                        from: pendingPromotion.from,
                        to: pendingPromotion.to,
                        promotion: piece,
                      });
                      applyOptimisticMove(pendingPromotion.from, pendingPromotion.to, piece);
                      setPendingPromotion(null);
                      setSelectedSquare(null);
                      setLegalStyles({});
                    } else if (pendingPreMovePromotion) {
                      setPreMove({
                        from: pendingPreMovePromotion.from,
                        to: pendingPreMovePromotion.to,
                        isCapture: pendingPreMovePromotion.isCapture,
                        promotion: piece,
                      });
                      setPreMoveStyles(
                        buildPreMoveStyle(
                          pendingPreMovePromotion.from,
                          pendingPreMovePromotion.to,
                          pendingPreMovePromotion.isCapture
                        )
                      );
                      setPendingPreMovePromotion(null);
                    }
                  }}
                  title={label}
                  aria-label={label}
                >
                  <span className="promotionDialog__symbol">
                    {PieceSvg && <PieceSvg />}
                  </span>
                  <span className="promotionDialog__label">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    )}
    <Chessboard
      options={{
        id: `board-${gameId}`,
        position: effectiveFen,
        boardOrientation: orientation,
        allowDragging: allowDrag,
        canDragPiece: ({ isSparePiece, square }) => {
          if (isSparePiece) return false;
          if (isReplay) return false;
          if (!myColor) return false;
          if (status === "finished") return false;
          if (!square) return false;

          const p = chess.get(square as Square);
          return !!p && p.color === myColor;
        },
        onSquareClick,
        onPieceDrop,
        squareStyles,
        onPieceDrag,
      }}
      
    />
    </div>
  );
}

export default memo(ChessBoardOnline);
