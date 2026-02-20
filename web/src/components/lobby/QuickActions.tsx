import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TIME_CONTROLS } from "../../constants/timeControls";
import { socket } from "../../socket/socket";
import Groups2Icon from '@mui/icons-material/Groups2';
import Person2Icon from '@mui/icons-material/Person2';
import DeveloperBoardIcon from '@mui/icons-material/DeveloperBoard';
type CreateGameAck =
  | { ok: true; data: { gameId: string; joinCode: string }; color: "white" }
  | { ok: false; error: string };

type JoinGameAck =
  | { ok: true; data: { gameId: string; joinCode?: string | null }; color: "black" | "white" }
  | { ok: false; error: string };

type ActionKey = "create" | "join";

export default function QuickActions({
  blocked,
  requestOpen,
  onRequestConsumed,
}: {
  blocked?: boolean;
  requestOpen?: ActionKey | null;
  onRequestConsumed?: () => void;
}) {
  const navigate = useNavigate();
  const [openAction, setOpenAction] = useState<ActionKey | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastBtnRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [createInitial, setCreateInitial] = useState(5);
  const [createIncrement, setCreateIncrement] = useState(3);

  const open = openAction != null;

  function close() {
    setOpenAction(null);
    setBusy(false);
    setError(null);
    setJoinCode("");
    window.setTimeout(() => lastBtnRef.current?.focus(), 0);
  }

  function clamp(n: number, min: number, max: number) {
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function setCreateTime(initial: number, increment: number) {
    setCreateInitial(clamp(Math.round(initial), 1, 180));
    setCreateIncrement(clamp(Math.round(increment), 0, 60));
  }

  function openModal(action: ActionKey, sourceBtn?: HTMLButtonElement | null) {
    if (blocked) return;
    if (sourceBtn) lastBtnRef.current = sourceBtn;
    setBusy(false);
    setError(null);
    if (action === "create") setCreateTime(5, 3);
    if (action === "join") setJoinCode("");
    setOpenAction(action);
  }

  function ensureConnected(): boolean {
    if (socket.connected) return true;
    setError("Sunucuya bağlanılamadı. Lütfen tekrar dene.");
    return false;
  }

  
  useEffect(() => {
    if (!requestOpen) return;
    if (blocked) {
      onRequestConsumed?.();
      return;
    }
    openModal(requestOpen, null);
    onRequestConsumed?.();
    
  }, [requestOpen, blocked]);

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    const onPointerDown = (e: PointerEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const t = e.target as Node | null;
      if (!t) return;
      if (!dialog.contains(t)) close();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);

  
    window.setTimeout(() => {
      const btn = dialogRef.current?.querySelector<HTMLButtonElement>("[data-autofocus='1']");
      btn?.focus();
    }, 0);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const title = openAction === "create" ? "Oyun ayarları" : "Odaya katıl";
  const subtitle = blocked
    ? "Aktif maçın varken yeni oyun başlatamazsın."
    : openAction === "create"
      ? "Süreyi seç ve odayı oluştur."
      : "Oda kodunu girip katıl.";

  return (
    <div className="quick-actions">
      <button
        type="button"
        onClick={(e) => {
          openModal("create", e.currentTarget);
        }}
      >
        <Groups2Icon fontSize="large" />
        <span>Oda oluştur</span>
      </button>

      <button
        type="button"
        onClick={(e) => {
          openModal("join", e.currentTarget);
        }}
      >
        <Person2Icon fontSize="large"/> <span>Arkadaşa meydan oku</span>
      </button>

      <button disabled type="button">
        <DeveloperBoardIcon fontSize="large"/> <span>Bilgisayara karşı (sonra)</span>
      </button>

      {open && (
        <div className="qaOverlay" role="presentation">
          <div className="qaModal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={title}>
            <button className="qaClose" type="button" onClick={close} aria-label="Kapat">
              ×
            </button>

            <div className="qaTitle">{title}</div>
            <div className="qaSub">{subtitle}</div>

            {error && <div className="qaError" role="alert">{error}</div>}

            {openAction === "create" && (
              <>
                <div className="qaClock" aria-label="Süre">
                  <div className="qaClock__top">
                    <div className="qaClock__label">Taraf başına dakika</div>
                    <div className="qaClock__value" aria-label="Süre">
                      <input
                        className="qaClockNum"
                        inputMode="numeric"
                        value={createInitial}
                        onChange={(e) => setCreateTime(Number(e.target.value || 0), createIncrement)}
                        disabled={busy}
                      />
                      <span className="qaClockPlus" aria-hidden="true">+</span>
                      <input
                        className="qaClockNum"
                        inputMode="numeric"
                        value={createIncrement}
                        onChange={(e) => setCreateTime(createInitial, Number(e.target.value || 0))}
                        disabled={busy}
                      />
                    </div>
                    <div className="qaClock__label qaClock__label--right">Hamle başına eklenen saniye</div>
                  </div>

                  <div className="qaClock__sliders">
                    <input
                      className="qaRange"
                      type="range"
                      min={1}
                      max={180}
                      step={1}
                      value={createInitial}
                      onChange={(e) => setCreateTime(Number(e.target.value), createIncrement)}
                      disabled={busy}
                    />
                    <input
                      className="qaRange"
                      type="range"
                      min={0}
                      max={60}
                      step={1}
                      value={createIncrement}
                      onChange={(e) => setCreateTime(createInitial, Number(e.target.value))}
                      disabled={busy}
                    />
                  </div>

                  <div className="qaClock__presets" role="group" aria-label="Hızlı süreler">
                    {TIME_CONTROLS.filter((t) => t.id !== "custom").map((tc) => {
                      const active = tc.initial === createInitial && tc.increment === createIncrement;
                      return (
                        <button
                          key={tc.id}
                          type="button"
                          className={`qaClockChip ${active ? "isActive" : ""}`}
                          onClick={() => setCreateTime(tc.initial, tc.increment)}
                          disabled={busy}
                        >
                          {tc.id}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="qaFooter">
                  <button
                    type="button"
                    className="qaBtn qaBtn--primary"
                    data-autofocus="1"
                    onClick={() => {
                      setError(null);
                      if (!ensureConnected()) return;
                      setBusy(true);
                      socket.emit(
                        "game:create",
                        { initial: createInitial, increment: createIncrement },
                        (res: CreateGameAck) => {
                          setBusy(false);
                          if (!res?.ok) {
                            setError(res?.error || "Oda oluşturulamadı.");
                            return;
                          }
                          close();
                          navigate(`/game/${res.data.gameId}?code=${res.data.joinCode}`);
                        }
                      );
                    }}
                    disabled={!!blocked || busy}
                  >
                    {busy ? "Oluşturuluyor…" : "Oda oluştur"}
                  </button>
                </div>

              </>
            )}

            {openAction === "join" && (
              <>
                <div className="qaForm">
                  <label className="qaLabel" htmlFor="joinCode">Oda kodu</label>
                  <input
                    id="joinCode"
                    className="qaInput"
                    value={joinCode}
                    placeholder="Örn: A1B2C3"
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    disabled={busy}
                    data-autofocus="1"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const code = joinCode.trim();
                      if (!code) return;
                      setError(null);
                      if (!ensureConnected()) return;
                      setBusy(true);
                      socket.emit("game:join", { joinCode: code }, (res: JoinGameAck) => {
                        setBusy(false);
                        if (!res?.ok) {
                          setError(res?.error || "Katılma başarısız.");
                          return;
                        }
                        close();
                        navigate(`/game/${res.data.gameId}`);
                      });
                    }}
                  />
                </div>

                <div className="qaFooter">
                  <button
                    type="button"
                    className="qaBtn qaBtn--primary"
                    disabled={busy || !joinCode.trim()}
                    onClick={() => {
                      const code = joinCode.trim();
                      if (!code) return;
                      setError(null);
                      if (!ensureConnected()) return;
                      setBusy(true);
                      socket.emit("game:join", { joinCode: code }, (res: JoinGameAck) => {
                        setBusy(false);
                        if (!res?.ok) {
                          setError(res?.error || "Katılma başarısız.");
                          return;
                        }
                        close();
                        navigate(`/game/${res.data.gameId}`);
                      });
                    }}
                  >
                    Katıl
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
