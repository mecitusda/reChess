import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AUTH_CHANGED_EVENT, getAuthToken, getOrCreateGuestId } from "../../auth/auth";
import { API_BASE_URL } from "../../config";
import { socket } from "../../socket/socket";
import type { MatchResult } from "../match-history/types";
import { MatchHistoryList } from "../match-history/MatchHistoryList";

export default function LobbyLeftPanel({
  activeGameId,
  onActiveGameIdChange,
}: {
  activeGameId: string | null;
  onActiveGameIdChange: (id: string | null) => void;
}) {
  const nav = useNavigate();
  const guestId = useMemo(() => getOrCreateGuestId(), []);
  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [recent, setRecent] = useState<MatchResult[]>([]);

  const cacheKey = useMemo(() => {
  
    const ident = token ? `user` : `guest:${guestId}`;
    return `recentMatches:${ident}`;
  }, [token, guestId]);

  const headers = useMemo(() => {
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-guest-id": guestId,
    };
  }, [token, guestId]);

  async function refreshRecent() {
    const res = await fetch(`${API_BASE_URL}/games/recent?limit=5`, { headers });
    const json = await res.json();
    const next = Array.isArray(json?.data) ? (json.data as MatchResult[]) : [];
    setRecent(next);
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data: next }));
    } catch {
    
    }
  }

  useEffect(() => {
    const onAuthChanged = () => setToken(getAuthToken());
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    window.addEventListener("storage", onAuthChanged);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
      window.removeEventListener("storage", onAuthChanged);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { at: number; data: MatchResult[] };
        if (Array.isArray(parsed?.data)) {
          setRecent(parsed.data);
        }
      }
    } catch {
    }

    (async () => {
      try {
        await refreshRecent();
      } catch {
        if (!mounted) return;
        setRecent((prev) => (prev.length ? prev : []));
      }
    })();

    return () => {
      mounted = false;
    };
  }, [headers, cacheKey]);

  return (
    <aside className="lobbyLeft">
      <section className="lobbyLeft__section">
        <div className="lobbyLeft__titleRow">
          <span
            className={`lobbyLeft__dot ${activeGameId ? "lobbyLeft__dot--on" : "lobbyLeft__dot--off"}`}
            aria-hidden="true"
          />
          <div className="lobbyLeft__title">Aktif oyun</div>
        </div>
        {activeGameId ? (
          <div className="lobbyLeft__primaryRow">
            <button
              type="button"
              className="lobbyLeft__primaryBtn"
              onClick={() => nav(`/game/${activeGameId}`)}
            >
              Devam et
            </button>
            <button
              type="button"
              className="lobbyLeft__dangerBtn"
              onClick={() => {
                const ok = confirm("Aktif oyunu terk etmek (pes etmek) istiyor musun?");
                if (!ok) return;
                const gid = activeGameId;
                socket.emit("game:resign", { gameId: gid }, (res: { ok: boolean; error?: string }) => {
                  if (res?.ok) {
                    onActiveGameIdChange(null);
                
                    refreshRecent().catch(() => {});
                    return;
                  }
                  alert(res?.error || "Resign failed");
                });
              }}
            >
              Terket
            </button>
          </div>
        ) : (
          <div className="lobbyLeft__muted">Aktif oyun yok.</div>
        )}
      </section>

      <section className="lobbyLeft__section">
        <div className="lobbyLeft__titleRow">
        <div className="lobbyLeft__title">Son maçlar</div>
        </div>

        <MatchHistoryList
          matches={recent}
          onOpenMatch={(id) => nav(`/game/${id}`)}
        />
      </section>
    </aside>
  );
}

