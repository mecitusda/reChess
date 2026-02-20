import { useEffect, useMemo, useState } from "react";
import { getAuthToken, getOrCreateGuestId } from "../auth/auth";
import { Link } from "react-router-dom";
import "./css/gamesPage.css";

type GameRow = {
  gameId: string;
  createdAt: string;
  winner: "white" | "black" | "draw" | null;
  reason: string;
  whiteName: string;
  blackName: string;
  whiteUserId?: string;
  blackUserId?: string;
  initialMs: number;
  incrementMs: number;
};

const GAMES_CACHE_TTL_MS = 1000 * 60 * 5; 

function fmtTC(initialMs: number, incrementMs: number) {
  const m = Math.round(initialMs / 60000);
  const inc = Math.round(incrementMs / 1000);
  return `${m}+${inc}`;
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function decodeJwtUserId(token: string): string | null {
 
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(padded));
    const uid = String(json?.userId || "");
    return uid ? uid : null;
  } catch {
    return null;
  }
}

export default function GamesPage() {
  const [rows, setRows] = useState<GameRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setError("Oyun geçmişi için giriş yapmalısın.");
      return;
    }

    const uid = decodeJwtUserId(token);
    setMyUserId(uid);

    const cacheKey = uid ? `gamesMe:${uid}` : "gamesMe:unknown";

    
    const cached = safeParseJson<{ at: number; data: GameRow[] }>(
      localStorage.getItem(cacheKey)
    );
    if (cached?.data?.length) {
      
      setRows(cached.data);
      
    }

    (async () => {
      try {
        setLoading(true);
        setError(null);

        
        if (cached && Date.now() - cached.at < GAMES_CACHE_TTL_MS) {
          return;
        }

        const res = await fetch("http://localhost:4000/games/me?limit=20", {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-guest-id": getOrCreateGuestId(),
          },
        });
        const json = await res.json();
        if (!json?.ok) throw new Error(json?.error || "FAILED");
        setRows(json.data);

        
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data: json.data }));
        } catch {
          console.error("Failed to cache games");
        }
      } catch (e: unknown) {
        
        const msg = e instanceof Error ? e.message : "FAILED";
        setError(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const list = useMemo(() => {
    return rows.map((g) => {
      const myColor =
        myUserId && g.whiteUserId === myUserId
          ? "white"
          : myUserId && g.blackUserId === myUserId
            ? "black"
            : null;

      const tone =
        g.winner === "draw"
          ? ("draw" as const)
          : g.winner && myColor
            ? g.winner === myColor
              ? ("win" as const)
              : ("loss" as const)
            : ("neutral" as const);

      const resultLabel =
        g.winner === "draw"
          ? "Berabere"
          : g.winner && myColor
            ? g.winner === myColor
              ? "Kazandın"
              : "Kaybettin"
            : g.winner
              ? `${g.winner} kazandı`
              : "Bitti";

      return { g, tone, resultLabel };
    });
  }, [rows, myUserId]);

  return (
    <div className="gamesPage">
      <div className="gamesPage__head">
        <div className="gamesPage__titleWrap">
          <div className="gamesPage__title">Oyunlarım</div>
          <div className="gamesPage__sub">
            Son {Math.min(20, rows.length || 20)} maç • {rows.length} kayıt
          </div>
        </div>
      </div>

      {error && <div className="gamesPage__error">{error}</div>}

      <div className="gamesList" aria-busy={loading ? "true" : "false"}>
        {loading && rows.length === 0 && (
          <>
            <div className="gameRow gameRow--skeleton" />
            <div className="gameRow gameRow--skeleton" />
            <div className="gameRow gameRow--skeleton" />
          </>
        )}

        {!loading && !error && list.length === 0 && (
          <div className="gamesEmpty">
            Henüz kayıtlı maçın yok.
          </div>
        )}

        {list.map(({ g, tone, resultLabel }) => (
          <div key={g.gameId} className={`gameRow gameRow--${tone}`}>
            <div className="gameRow__main">
              <div className="gameRow__top">
                <div className="gameRow__names" title={`${g.whiteName} vs ${g.blackName}`}>
                  {(() => {
                    const myIsWhite = !!(myUserId && g.whiteUserId === myUserId);
                    const myIsBlack = !!(myUserId && g.blackUserId === myUserId);
                    const oppName = myIsWhite ? g.blackName : myIsBlack ? g.whiteName : null;
                    const oppUserId = myIsWhite ? g.blackUserId : myIsBlack ? g.whiteUserId : null;
                    const oppEl =
                      oppName && oppUserId ? (
                        <Link className="gameRow__nameLink" to={`/u/${encodeURIComponent(oppName)}`}>
                          {oppName}
                        </Link>
                      ) : (
                        oppName || null
                      );

                    return (
                      <>
                        {g.whiteName} <span className="gameRow__vs">vs</span> {oppEl ?? g.blackName}
                      </>
                    );
                  })()}
                </div>
                
              </div>

              <div className="gameRow__meta">
                <span className="gameRow__tc">{fmtTC(g.initialMs, g.incrementMs)}</span>
                <span className="gameRow__dot" aria-hidden="true">•</span>
                <span className="gameRow__reason">{g.reason}</span>
                <span className="gameRow__dot" aria-hidden="true">•</span>
                <span className="gameRow__date">{new Date(g.createdAt).toLocaleString()}</span>
              </div>
            </div>
            <div className="gameRow__right">
              <div className={`gameRow__pill gameRow__pill--${tone}`}>
                {resultLabel}
              </div>
              <Link className="gameRow__open" to={`/game/${g.gameId}`} aria-label="Maçı aç">
                Aç
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

