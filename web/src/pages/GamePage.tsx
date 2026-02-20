import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { socket } from "../socket/socket";
import ChessBoardOnline from "./ChessBoardOnline";
import type { Square } from "chess.js";
import "./css/gamePage.css"
import { Chess } from "chess.js";
import { getAuthToken, getOrCreateGuestId } from "../auth/auth";
import { API_BASE_URL } from "../config";
import { useActiveGame } from "../context/ActiveGameContext";
import {
  playMoveSound,
  playCaptureSound,
  playCheckSound,
  playCheckmateSound,
  playNotifySound,
  preloadGameSounds,
} from "../sounds/gameSounds";
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
type ServerState = {
  gameId: string;
  fen: string;
  turn: "w" | "b";
  status: "waiting" | "active" | "finished";
  joinCode?: string;
  winner?: "white" | "black" | "draw" | null;
  reason?: string | null;
  initialMs?: number;
  incrementMs?: number;
  whiteName?: string | null;
  blackName?: string | null;
  whiteTime?: number;
  blackTime?: number;
  serverNow?: number; 
  lastMove?: { from: Square; to: Square}
  moves?: MoveItem[];
  readyDeadline?: number;
  disconnected?: {
    white: boolean;
    black: boolean;
    whiteAt?: number | null;
    blackAt?: number | null;
  };
  whiteRating?: number | null;
  blackRating?: number | null;
  whiteRatingDiff?: number | null;
  blackRatingDiff?: number | null;
};
type EndedPayload = {
  gameId?: string;
  status: "finished";
  reason: string;
  winner: "white" | "black" | "draw" | null;
  whiteRating?: number | null;
  blackRating?: number | null;
  whiteRatingDiff?: number | null;
  blackRatingDiff?: number | null;
};

type SyncAck =
  | {
      ok: true;
      data: ServerState & { myColor: "w" | "b" | null; moves?: MoveItem[] };
    }
  | { ok: false; error: string };

type JoinAck =
  | { ok: true; data: { gameId: string; joinCode?: string | null }; color: "black" | "white" }
  | { ok: false; error: string };

type MoveItem = {
  ply: number;
  san: string;
  fen: string;
  from: Square;
  to: Square;
};

type GameReplayResponse = {
  ok: true;
  data: {
    gameId: string;
    createdAt: string;
    winner: "white" | "black" | "draw" | null;
    reason: string;
    whiteName: string;
    blackName: string;
    initialMs: number;
    incrementMs: number;
    whiteTime: number;
    blackTime: number;
    finalFen: string;
    moves: MoveItem[];
    pgn: string;
  };
};

const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function clamp01(x: number) {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function normalizeUsername(u: string) {
  return String(u || "").trim().toLowerCase().replace(/\s+/g, "");
}

function formatSecondsAsClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}


const CLAIM_WIN_MS = 50_000;

function remainingReconnectMs(at?: number | null) {
  if (!at) return null;
  const left = CLAIM_WIN_MS - (Date.now() - at);
  return Math.max(0, left);
}

export default function GamePage() {
  const { gameId } = useParams();
  const [sp] = useSearchParams();
  const code = sp.get("code"); // davet linkinden geldiyse
  const navigate = useNavigate();
  const { setInActiveGame, setOpponentConnected, opponentConnected } = useActiveGame();
  const [state, setState] = useState<ServerState | null>(null);
  const [myColor, setMyColor] = useState<"w" | "b" | null>(null);
  const [ended, setEnded] = useState<EndedPayload | null>(null);
  const [drawOfferFrom, setDrawOfferFrom] = useState<"white" | "black" | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const inviteCopyTimerRef = useRef<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  
  // local timer
  const [localWhite, setLocalWhite] = useState<number | null>(null);
  const [localBlack, setLocalBlack] = useState<number | null>(null);
  const [readyLeftMs, setReadyLeftMs] = useState<number | null>(null);

  const clockAnchorRef = useRef<{
    whiteTime: number;
    blackTime: number;
    turn: "w" | "b";
    status: "waiting" | "active" | "finished";
    serverNow: number;
  } | null>(null);
  const lastDisplayedWhiteRef = useRef<number | null>(null);
  const lastDisplayedBlackRef = useRef<number | null>(null);

  const [moves, setMoves] = useState<MoveItem[]>([]);
  const [cursor, setCursor] = useState(0);
  const movesListRef = useRef<HTMLDivElement | null>(null);

  
  const prevFenRef = useRef<string | null>(null);
  const applyingRef = useRef(false);
  const stateRef = useRef<ServerState | null>(null);
  const myColorRef = useRef<"w" | "b" | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    myColorRef.current = myColor;
  }, [myColor]);

  useEffect(() => {
    return () => {
      if (inviteCopyTimerRef.current != null) {
        window.clearTimeout(inviteCopyTimerRef.current);
        inviteCopyTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    preloadGameSounds();
  }, []);

  const mySide: "w" | "b" = myColor ?? "w";
  const oppSide: "w" | "b" = mySide === "w" ? "b" : "w";

  async function loadReplayFromDb(gid: string) {
    const token = getAuthToken();
    if (!token) return false;

    try {
      const res = await fetch(`${API_BASE_URL}/games/${gid}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-guest-id": getOrCreateGuestId(),
        },
      });
      const json = (await res.json()) as GameReplayResponse | { ok: false; error: string };
      if (!json || json.ok !== true) return false;

      const finalFen = json.data.finalFen || START_FEN;
      const last = json.data.moves?.length
        ? {
            from: json.data.moves[json.data.moves.length - 1].from,
            to: json.data.moves[json.data.moves.length - 1].to,
          }
        : null;

      setState({
        gameId: json.data.gameId,
        fen: finalFen,
        turn: new Chess(finalFen).turn(),
        status: "finished",
        initialMs: json.data.initialMs,
        incrementMs: json.data.incrementMs,
        whiteName: json.data.whiteName || null,
        blackName: json.data.blackName || null,
        whiteTime: json.data.whiteTime,
        blackTime: json.data.blackTime,
        serverNow: Date.now(),
        lastMove: last ?? undefined,
        disconnected: { white: false, black: false, whiteAt: null, blackAt: null },
      });
      setMyColor(null);

      const mv = Array.isArray(json.data.moves) ? json.data.moves : [];
      setMoves(mv);
      setCursor(mv.length);

      setEnded({
        gameId: json.data.gameId,
        status: "finished",
        reason: json.data.reason,
        winner: json.data.winner,
      });

      return true;
    } catch {
      return false;
    }
  }

  function renderClock(c: "w" | "b", placement: "top" | "bottom") {
    if (!state) return null;

    const isReady = state.status === "waiting" && readyLeftMs !== null;
    const isFinished = state.status === "finished";
    const READY_TOTAL_MS = 30_000;

    const baseTotalMs =
      (state.initialMs && state.initialMs > 0
        ? state.initialMs
        : Math.max(state.whiteTime ?? 0, state.blackTime ?? 0, 1)) || 1;

    const getMainMs = () => {
      if (isReady) {
        return c === state.turn ? readyLeftMs! : READY_TOTAL_MS;
      }
      return c === "w"
        ? (isFinished
            ? state.whiteTime ?? 0
            : localWhite ?? state.whiteTime ?? 0)
        : (isFinished
            ? state.blackTime ?? 0
            : localBlack ?? state.blackTime ?? 0);
    };

    const getMainDisplay = () => {
      if (isReady) {
        const ms = c === state.turn ? readyLeftMs! : READY_TOTAL_MS;
        return formatSecondsAsClock(Math.ceil(ms / 1000));
      }
      return c === "w"
        ? formatTime(localWhite ?? state.whiteTime ?? 0)
        : formatTime(localBlack ?? state.blackTime ?? 0);
    };

    const isActive =
      !isFinished &&
      (state.status === "active" || state.status === "waiting") &&
      state.turn === c;

    const nm =
      c === "w" ? state.whiteName || "White" : state.blackName || "Black";
    const label = c === "w" ? `♔ ${nm}` : `♚ ${nm}`;

  
    const showPresenceDot = placement === "top";
    const isOnline = showPresenceDot ? opponentConnected : false;
    const extraClass = placement === "top" ? "clockBox--top" : "clockBox--bottom";
    const innerClass = placement === "top" ? "clockInner clockInner--reverse" : "clockInner";

    return (
      <div className={`clockBox ${isActive ? "clockBox--active" : ""} ${extraClass}`}>
        <div className={innerClass}>
          <div className="clockRow">
            <div className="clockRow__label">
              {showPresenceDot && (
                <span
                  className={`presenceDot ${isOnline ? "presenceDot--online" : "presenceDot--offline"}`}
                  title={isOnline ? "Online" : "Offline"}
                />
              )}
              {label}
              <span className="clockRow__rating">
                {(c === "w" ? state.whiteRating : state.blackRating) != null ? (
                  <>
                    {c === "w" ? state.whiteRating : state.blackRating}
                    {state.status === "finished" &&
                      (c === "w" ? state.whiteRatingDiff : state.blackRatingDiff) != null &&
                      (c === "w" ? state.whiteRatingDiff! : state.blackRatingDiff!) !== 0 && (

                        <span className={`clockRow__ratingDiff ${(c === "w" ? state.whiteRatingDiff! : state.blackRatingDiff!) > 0 ? "clockRow__ratingDiff--positive" : "clockRow__ratingDiff--negative"}`}>
                          {(c === "w" ? state.whiteRatingDiff! : state.blackRatingDiff!) > 0 ? "+" : ""}
                          {c === "w" ? state.whiteRatingDiff : state.blackRatingDiff}
                        </span>
                      )}
                  </>
                ) : (
                  "1500?"
                )}
              </span>
            </div>
            <div className="clockRow__time">{getMainDisplay()}</div>
          </div>
          <div className={`clockBar ${placement === "top" ? "clockBar--top" : "clockBar--bottom"}`}>
            <div
              className="clockBar__fill"
              style={{
                width: `${Math.round(
                  100 *
                    clamp01(getMainMs() / (isReady ? READY_TOTAL_MS : baseTotalMs))
                )}%`,
              }}
            />
          </div>
        </div>
      </div>
    );
  }


  const moveRows = useMemo(() => {
    const rows: {
      no: number;
      white?: { san: string; idx: number };
      black?: { san: string; idx: number };
    }[] = [];

    for (let i = 0; i < moves.length; i += 2) {
      rows.push({
        no: Math.floor(i / 2) + 1,
        white: moves[i]
          ? { san: moves[i].san, idx: i + 1 }
          : undefined,
        black: moves[i + 1]
          ? { san: moves[i + 1].san, idx: i + 2 }
          : undefined,
      });
    }

    return rows;
  }, [moves]);


  // Aktif hamle satırını sadece liste kutusu içinde kaydır; sayfayı (window) kaydırma — mobilde panel aşağı kaymasın
  useEffect(() => {
    const list = movesListRef.current;
    if (!list) return;
    const active = list.querySelector(".move-cell.active") as HTMLElement | null;
    const row = active?.closest(".move-row") as HTMLElement | null;
    if (!row) return;

    const rowTop = row.offsetTop;
    const rowHeight = row.offsetHeight;
    const listHeight = list.clientHeight;
    const scrollMax = list.scrollHeight - listHeight;
    if (scrollMax <= 0) return;

    const targetScroll = rowTop - listHeight / 2 + rowHeight / 2;
    list.scrollTop = Math.max(0, Math.min(targetScroll, scrollMax));
  }, [cursor, moves.length]);

  const readyLastSecRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      !state ||
      state.status !== "waiting" ||
      state.readyDeadline == null ||
      state.serverNow == null
    ) {
      setReadyLeftMs(null);
      readyLastSecRef.current = null;
      return;
    }

    const deadline = state.readyDeadline!;
    const offset = Date.now() - state.serverNow;
    const tick = () => {
      const left = Math.max(0, deadline - (Date.now() - offset));
      const sec = Math.ceil(left / 1000);
      if (readyLastSecRef.current !== sec) {
        readyLastSecRef.current = sec;
        setReadyLeftMs(left);
      }
    };

    tick();
    const interval = setInterval(tick, 250);

    return () => clearInterval(interval);
  }, [state?.status, state?.readyDeadline, state?.serverNow]);

  const opponentName = state && myColor
    ? (myColor === "w" ? state.blackName : state.whiteName)
    : null;
  const opponentNameNorm = opponentName ? normalizeUsername(opponentName) : "";

  useEffect(() => {
    if (!opponentNameNorm || !gameId) return;
    setOpponentConnected(true);
    socket.emit("presence:subscribe", { username: opponentNameNorm });
    const onStatus = (p: { username: string; online: boolean }) => {
      if (normalizeUsername(p.username) === opponentNameNorm) setOpponentConnected(p.online);
    };
    const onOnline = (p: { username: string }) => {
      if (normalizeUsername(p.username) === opponentNameNorm) setOpponentConnected(true);
    };
    const onOffline = (p: { username: string }) => {
      if (normalizeUsername(p.username) === opponentNameNorm) setOpponentConnected(false);
    };
    socket.on("presence:status", onStatus);
    socket.on("presence:online", onOnline);
    socket.on("presence:offline", onOffline);
    return () => {
      socket.emit("presence:unsubscribe", { username: opponentNameNorm });
      socket.off("presence:status", onStatus);
      socket.off("presence:online", onOnline);
      socket.off("presence:offline", onOffline);
    };
  }, [gameId, opponentNameNorm, setOpponentConnected]);

  useEffect(() => {
    if (!gameId) return;

    const onState = (s: ServerState) => {
      if (s.gameId !== gameId) return;
      setLoadError(null);

      const my = myColorRef.current;
      if (my === "w") setOpponentConnected(!s.disconnected?.black);
      else if (my === "b") setOpponentConnected(!s.disconnected?.white);

      const prev = stateRef.current;
      const disconnectedUnchanged =
        prev?.disconnected?.white === s.disconnected?.white &&
        prev?.disconnected?.black === s.disconnected?.black;

      const onlyClockTicked =
        prev &&
        prev.fen === s.fen &&
        prev.status === s.status &&
        prev.turn === s.turn &&
        prev.winner === s.winner &&
        prev.reason === s.reason &&
        (prev.lastMove?.from === s.lastMove?.from && prev.lastMove?.to === s.lastMove?.to) &&
        prev.whiteName === s.whiteName &&
        prev.blackName === s.blackName &&
        disconnectedUnchanged;

      if (onlyClockTicked && s.whiteTime != null && s.blackTime != null && s.serverNow != null) {
        clockAnchorRef.current = {
          whiteTime: s.whiteTime,
          blackTime: s.blackTime,
          turn: s.turn,
          status: s.status,
          serverNow: s.serverNow,
        };
        return;
      }

      const lastMoveChanged =
        !prev ||
        prev.lastMove?.from !== s.lastMove?.from ||
        prev.lastMove?.to !== s.lastMove?.to;
      const opponentJustMoved =
        s.lastMove && my != null && s.turn === my;

      if (lastMoveChanged && opponentJustMoved) {
        if (s.status === "finished" && s.reason === "checkmate") {
          playCheckmateSound();
        } else if (prev?.fen && s.lastMove) {
          try {
            const chess = new Chess(prev.fen);
            const piece = chess.get(s.lastMove.from);
            const isPawnPromo =
              piece?.type === "p" &&
              ((piece.color === "w" && s.lastMove.to.endsWith("8")) ||
                (piece.color === "b" && s.lastMove.to.endsWith("1")));
            const moveObj = chess.move({
              from: s.lastMove.from,
              to: s.lastMove.to,
              ...(isPawnPromo ? { promotion: "q" as const } : {}),
            });
            if (moveObj) {
              if (chess.inCheck()) playCheckSound();
              else if (moveObj.captured) playCaptureSound();
              else playMoveSound();
            } else {
              playMoveSound();
            }
          } catch {
            playMoveSound();
          }
        } else {
          playMoveSound();
        }
      }

      setState(s);
    };
    const onEnded = (p: EndedPayload) => {
      if (p?.gameId && p.gameId !== gameId) return;
      if (p.reason !== "checkmate") playNotifySound();
      setInActiveGame(null);
      setEnded(p);
      setState((prev) =>
        prev
          ? {
              ...prev,
              status: "finished",
              whiteRating: p.whiteRating ?? prev.whiteRating,
              blackRating: p.blackRating ?? prev.blackRating,
              whiteRatingDiff: p.whiteRatingDiff ?? prev.whiteRatingDiff,
              blackRatingDiff: p.blackRatingDiff ?? prev.blackRatingDiff,
            }
          : prev
      );
    };
    const onDrawOffered = (p: { by: "white" | "black" }) => {
      if (
        (p.by === "white" && myColor === "w") ||
        (p.by === "black" && myColor === "b")
      ) {
        return;
      }
      playNotifySound();
      setDrawOfferFrom(p.by);
    };

    const onDrawDeclined = () => {
      setDrawOfferFrom(null);
    };
    
    socket.on("game:state", onState);
    socket.on("game:ended", onEnded);
    socket.on("game:draw_offered", onDrawOffered);
    socket.on("game:draw_declined", onDrawDeclined);

    const doSync = () =>
      socket.emit("game:request_sync", { gameId }, (res: SyncAck) => {
      if (!res?.ok) {
        loadReplayFromDb(gameId).then((ok) => {
          if (ok) setLoadError(null);
          else setLoadError(res?.error || "GAME_NOT_FOUND");
        });
        return;
      }
      setState(res.data);
      setMyColor(res.data.myColor);
      setLoadError(null);
      const my = res.data.myColor;
      if (my === "w") setOpponentConnected(!res.data.disconnected?.black);
      else if (my === "b") setOpponentConnected(!res.data.disconnected?.white);
      if (res.data.myColor === "w" || res.data.myColor === "b") {
        if (res.data.status === "finished") {
          setInActiveGame(null);
        } else {
          setInActiveGame(gameId);
        }
      } else {
        setInActiveGame(null);
      }
    
      if (res.data.status === "finished" && (res.data.reason || res.data.winner)) {
        setEnded((prev) =>
          prev?.status === "finished" && prev?.gameId === gameId
            ? prev
            : {
                gameId,
                status: "finished",
                reason: res.data.reason || "finished",
                winner: res.data.winner ?? null,
              }
        );
      }
      if (Array.isArray(res.data.moves)) {
        setMoves(res.data.moves);
        setCursor(res.data.moves.length);
      }
      if (
        res.data.status === "finished" &&
        (!Array.isArray(res.data.moves) || res.data.moves.length === 0)
      ) {
        loadReplayFromDb(gameId);
      }

      if (res.data.myColor === "w") {
        socket.emit("game:reconnected", { gameId });
      }
      if (res.data.myColor === "b") {
        socket.emit("game:reconnected", { gameId });
      }
    });

    const run = () => {
     
      const joinCode = code ? String(code).trim().toUpperCase() : "";
      if (joinCode) {
        socket.emit("game:join", { joinCode }, (res: JoinAck) => {
        
          if (res?.ok && res?.data?.gameId && res.data.gameId !== gameId) {
            navigate(`/game/${res.data.gameId}?code=${joinCode}`, { replace: true });
            return;
          }
          doSync();
        });
        return;
      }


      doSync();
    };

    
    const onConnect = () => run();
    const onConnectErr = () => {
      console.warn("[GamePage] socket connect_error");
    };

    if (socket.connected) run();
    else {
      try {
        socket.connect();
      } catch {
      }
      socket.once("connect", onConnect);
      socket.once("connect_error", onConnectErr);
    }

    return () => {
      setInActiveGame(null);
      setOpponentConnected(true);
      socket.off("game:state", onState);
      socket.off("game:ended", onEnded);
      socket.off("game:draw_offered", onDrawOffered);
      socket.off("game:draw_declined", onDrawDeclined);
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectErr);

    };
  }, [gameId, code, setInActiveGame, setOpponentConnected]);

  const invite = useMemo(() => {
    if (!gameId) return null;
    const joinCode = state?.joinCode || code || "";
    return joinCode
      ? `${window.location.origin}/game/${gameId}?code=${joinCode}`
      : null;
  }, [gameId, state?.joinCode, code]);
  
  const statusLabel = useMemo(() => {
    switch (state?.status) {
      case "waiting":
        return "Hazırlanıyor";
      case "active":
        return "Devam ediyor";
      case "finished":
        return "Bitti";
      default:
        return "";
    }
  }, [state?.status]);

  const gameTypeLabel = useMemo(() => {
    const init = state?.initialMs ?? null;
    const inc = state?.incrementMs ?? 0;
    if (!init || init <= 0) return "Sınırsız";

    const mins = Math.max(1, Math.round(init / 60_000));
    const incSec = Math.max(0, Math.round((inc ?? 0) / 1000));
    const tc = `${mins}+${incSec}`;

    const cat =
      mins <= 2 ? "Bullet" : mins <= 10 ? "Blitz" : mins <= 20 ? "Hızlı" : "Klasik";

    return `${cat} • ${tc}`;
  }, [state?.initialMs, state?.incrementMs]);

  const endedSummary = useMemo(() => {
    if (!ended) return null;

    if (ended.reason === "aborted") {
      return {
        title: "Oyun iptal edildi",
        desc: "Oyunculardan biri oyuna başlamadı.",
        meta: null as string | null,
        tone: "aborted" as const,
      };
    }

    const resultText =
      ended.winner === "draw"
        ? "Beraberlik"
        : ended.winner
          ? `${ended.winner} kazandı`
          : "Bitti";

    const tone = (() => {
      if (ended.winner === "draw") return "draw" as const;
      if (!ended.winner) return "ended" as const;
      if (!myColor) return "ended" as const;
      const mySide = myColor === "w" ? "white" : "black";
      return ended.winner === mySide ? ("win" as const) : ("loss" as const);
    })();

    return {
      title: "Oyun sonucu",
      desc: resultText,
      meta: ended.reason ? `Sebep: ${ended.reason}` : null,
      tone,
    };
  }, [ended, myColor]);

  useEffect(() => {
  if (!state?.fen) return;


  if (prevFenRef.current == null) {
    prevFenRef.current = state.fen;
    return;
  }


  if (prevFenRef.current === state.fen) return;


  if (!state.lastMove) {
    prevFenRef.current = state.fen;
    return;
  }

  if (applyingRef.current) return;
  applyingRef.current = true;

  try {
    const chess = new Chess(prevFenRef.current);
    const { from, to } = state.lastMove;
    const piece = chess.get(from);
    const isPawnPromotion =
      piece?.type === "p" &&
      ((piece.color === "w" && to.endsWith("8")) ||
        (piece.color === "b" && to.endsWith("1")));

    const mv = chess.move(
      isPawnPromotion ? { from, to, promotion: "q" } : { from, to }
    );

    if (!mv) {
      prevFenRef.current = state.fen;
      return;
    }

    const nextFen = chess.fen();

    setMoves((old) => {
      if (old.length && old[old.length - 1].fen === nextFen) return old;

      const next = [
        ...old,
        {
          ply: old.length + 1,
          san: mv.san,
          fen: nextFen,
          from,
          to,
        },
      ];


      setCursor((c) => (c === old.length ? next.length : c));

      return next;
    });

    prevFenRef.current = state.fen;
  } finally {
    applyingRef.current = false;
  }
}, [state?.fen, state?.lastMove?.from, state?.lastMove?.to]);


  useEffect(() => {
    if (
      !state ||
      state.whiteTime == null ||
      state.blackTime == null ||
      state.serverNow == null
    ) {
      return;
    }


    if (cursor !== moves.length) return;

    clockAnchorRef.current = {
      whiteTime: state.whiteTime,
      blackTime: state.blackTime,
      turn: state.turn,
      status: state.status,
      serverNow: state.serverNow,
    };
    lastDisplayedWhiteRef.current = null;
    lastDisplayedBlackRef.current = null;

    setLocalWhite(state.whiteTime);
    setLocalBlack(state.blackTime);
  }, [
    state?.whiteTime,
    state?.blackTime,
    state?.serverNow,
    state?.turn,
    state?.status,
    cursor,
    moves.length,
  ]);

  useEffect(() => {
    const tick = () => {
      const a = clockAnchorRef.current;
      if (!a) return;
      if (a.status !== "active") {
        setLocalWhite(a.whiteTime);
        setLocalBlack(a.blackTime);
        lastDisplayedWhiteRef.current = null;
        lastDisplayedBlackRef.current = null;
        return;
      }

      const elapsed = Date.now() - a.serverNow;
      const whiteMs = a.turn === "w" ? a.whiteTime - elapsed : a.whiteTime;
      const blackMs = a.turn === "b" ? a.blackTime - elapsed : a.blackTime;
      const whiteSec = Math.floor(whiteMs / 1000);
      const blackSec = Math.floor(blackMs / 1000);

      if (lastDisplayedWhiteRef.current !== whiteSec) {
        lastDisplayedWhiteRef.current = whiteSec;
        setLocalWhite(whiteMs);
      }
      if (lastDisplayedBlackRef.current !== blackSec) {
        lastDisplayedBlackRef.current = blackSec;
        setLocalBlack(blackMs);
      }
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, []);


  const isReplay = cursor !== moves.length;

  const displayFen = isReplay
    ? cursor === 0
      ? START_FEN
      : moves[cursor - 1]?.fen ?? START_FEN
    : state?.fen ?? START_FEN;

  const replayLastMove = useMemo(() => {
    if (isReplay) {
      if (cursor === 0) return null;
      const m = moves[cursor - 1];
      return m ? { from: m.from, to: m.to } : null;
    }
    const lm = state?.lastMove;
    return lm ? { from: lm.from, to: lm.to } : null;
  }, [
    isReplay,
    cursor,
    state?.lastMove?.from,
    state?.lastMove?.to,
    moves[cursor - 1]?.from,
    moves[cursor - 1]?.to,
  ]);

  return (
    <div className="container gamePage">
      {!state ? (
        <p>{loadError ? `Yüklenemedi: ${loadError}` : "Yükleniyor..."}</p>
      ) : (
        <>
         
          <div className="game">
          {/* Mobilde sol panel gizli olduğu için beraberlik teklifini burada da göster (sadece küçük ekranda görünür) */}
          {drawOfferFrom && ended == null && (
            <div className="drawOfferBanner">
              <div className="drawOfferBanner__title">Beraberlik teklifi</div>
              <div className="drawOfferBanner__desc">Rakip beraberlik teklif etti. Kabul ediyor musun?</div>
              <div className="drawOfferBanner__actions">
                <button
                  type="button"
                  className="miniBtn miniBtn--primary"
                  onClick={() => {
                    socket.emit("game:draw_accept", { gameId });
                    setDrawOfferFrom(null);
                  }}
                >
                   Kabul
                </button>
                <button
                  type="button"
                  className="miniBtn"
                  onClick={() => {
                    socket.emit("game:draw_decline", { gameId });
                    setDrawOfferFrom(null);
                  }}
                >
                   Reddet
                </button>
              </div>
            </div>
          )}

          {/* Mobilde sol panel gizli: oyun bitişi / iptal bilgisi */}
          {endedSummary && (
            <div className={`gameResultBanner gameResultBanner--${endedSummary.tone}`}>
              <div className="gameResultBanner__title">{endedSummary.title}</div>
              <div className="gameResultBanner__desc">{endedSummary.desc}</div>
              {endedSummary.meta && (
                <div className="gameResultBanner__meta">{endedSummary.meta}</div>
              )}
            </div>
          )}

          <div className="bar__left leftPanel">
            <div className="leftPanel__header">
              <div className="leftPanel__titleWrap">
                <div className="leftPanel__title">Oyun</div>
                <div className="leftPanel__subtitle">{gameTypeLabel}</div>
              </div>
              <div className={`statusPill statusPill--${state.status}`}>
                <span className="statusPill__dot" aria-hidden="true" />
                <span className="statusPill__text">{statusLabel}</span>
              </div>
            </div>

            <div className="leftPanel__body">
              {invite && (
                <div className="inviteCard">
                  <div className="inviteCard__label">Davet linki</div>
                  <div className="inviteCard__value">
                    <div
                      className={`inviteCopyField ${inviteCopied ? "isCopied" : ""}`}
                      role="group"
                      aria-label="Davet linki kopyala"
                    >
                      <code className="inviteCopyField__code" title={invite}>
                        <div className="inviteCopyField__code__text">{invite}</div>
                        <button
                          type="button"
                          className="inviteCopyField__btn"
                          aria-label="Kopyala"
                          onClick={() => {
                            navigator.clipboard?.writeText(invite);
                            setInviteCopied(true);
                            if (inviteCopyTimerRef.current != null) {
                              window.clearTimeout(inviteCopyTimerRef.current);
                            }
                            inviteCopyTimerRef.current = window.setTimeout(() => {
                              setInviteCopied(false);
                              inviteCopyTimerRef.current = null;
                            }, 1600);
                          }}
                        >
                          <ContentCopyIcon style={{ fontSize: "1.2rem" }} />
                        </button>
                      </code>
                    </div>
                  </div>
                </div>
              )}

              {drawOfferFrom && ended == null && (
                <div className="noticeCard">
                  <div className="noticeCard__title">Beraberlik teklifi</div>
                  <div className="noticeCard__desc">
                    Rakip beraberlik teklif etti. Kabul ediyor musun?
                  </div>
                  <div className="noticeCard__actions">
                    <button
                      type="button"
                      className="miniBtn miniBtn--primary"
                      onClick={() => {
                        socket.emit("game:draw_accept", { gameId });
                        setDrawOfferFrom(null);
                      }}
                    >
                      Kabul
                    </button>
                    <button
                      type="button"
                      className="miniBtn"
                      onClick={() => {
                        socket.emit("game:draw_decline", { gameId });
                        setDrawOfferFrom(null);
                      }}
                    >
                       Reddet
                    </button>
                  </div>
                </div>
              )}

              {endedSummary && (
                <div className={`resultCard resultCard--${endedSummary.tone}`}>
                  <div className="resultCard__title">{endedSummary.title}</div>
                  <div className="resultCard__desc">{endedSummary.desc}</div>
                  {endedSummary.meta && (
                    <div className="resultCard__meta">{endedSummary.meta}</div>
                  )}
                </div>
              )}
            </div>
          </div>
          
          <ChessBoardOnline
            gameId={gameId!}
            fen={displayFen}
            turn={state.turn}
            status={state.status}
            myColor={myColor}
            lastMove={replayLastMove}
            isReplay={isReplay}
          />
          <div className="bar__right rightPanel">
            
            {renderClock(oppSide, "top")}

            <div className="rightPanel__content">
            {state?.disconnected && myColor && (() => {
              const isOppDisconnected =
                (myColor === "w" && state.disconnected.black) ||
                (myColor === "b" && state.disconnected.white);

              const oppAt =
                myColor === "w" ? state.disconnected.blackAt : state.disconnected.whiteAt;

              const left = remainingReconnectMs(oppAt) ?? null;
              const canClaim = isOppDisconnected && left === 0 && state.status === "active" && !ended;

              return (
                <>
                  {isOppDisconnected && left != null && left > 0 && (

      <div className="reconnect-banner">
        {myColor === "w" ? "♚" : "♔"} Rakip bağlantıyı kaybetti –
        {Math.ceil(left / 1000)} sn içinde dönmezse kazanacaksın
      </div>
                  )}

                 
                  {canClaim && (
                    <button
                      className="actionBtn winClaimBtn"
                      onClick={() => socket.emit("game:claim_win", { gameId })}
                      style={{ width: "100%" }}
                    >
                      Kazanmayı talep et
                    </button>
                  )}
                </>
              );
            })()}

          <div className="actionsRow">
            <button 
              disabled={!state || state.status !== "active" || ended != null}
              onClick={() => socket.emit("game:resign", { gameId })}
              className="actionBtn"
              title="Pes et"
              aria-label="Pes et"
            >
              🏳️
            </button>

            <button
              disabled={!state || state.status !== "active" || ended != null}
              onClick={() => socket.emit("game:draw_offer", { gameId })}
              className="actionBtn"
              title="Beraberlik teklif et"
              aria-label="Beraberlik teklif et"
            >
              <span className="drawHalf" aria-hidden="true">½</span>
            </button>

            <button
              disabled={!state || state.status !== "waiting" || ended != null || !readyLeftMs || readyLeftMs <= 0}
              onClick={() => socket.emit("game:abort", { gameId })}
              className="actionBtn"
              title="Oyunu iptal et"
              aria-label="Oyunu iptal et"
            >
              ✕
            </button>
        </div>
          <div className="moves-panel">
  <div className="moves-header">
    <span className="moves-header-text">Hamleler</span>
    <div className="controls">
      <button onClick={() => setCursor(0)}>⏮</button>
      <button onClick={() => setCursor(c => Math.max(0, c - 1))}>◀</button>
      <button onClick={() => setCursor(c => Math.min(moves.length, c + 1))}>▶</button>
      <button onClick={() => setCursor(moves.length)}>⏭</button>
    </div>
  </div>

  <div className="moves-list" ref={movesListRef}>
  {moveRows.map((row) => (
  <div key={row.no} className="move-row">
    <span className="move-no">{row.no}.</span>

    <span
      className={`move-cell ${cursor === row.white?.idx ? "active" : ""}`}
      onClick={() => row.white && setCursor(row.white.idx)}
    >
      {row.white?.san ?? ""}
    </span>

    <span
      className={`move-cell ${cursor === row.black?.idx ? "active" : ""}`}
      onClick={() => row.black && setCursor(row.black.idx)}
    >
      {row.black?.san ?? ""}
    </span>
  </div>
))}
</div>


  </div>
          </div>
          {renderClock(mySide, "bottom")}
          </div>

            
          
          </div>
          
         

        </>
      )}
    </div>
  );
}
