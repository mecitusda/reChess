import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuthToken, setAuthToken, getOrCreateGuestId } from "../auth/auth";
import { API_BASE_URL } from "../config";
import { identifySocket } from "../socket/socket";
import "./css/authPage.css";
import AuthVisual from "./AuthVisual";
import KeyboardBackspaceIcon from '@mui/icons-material/KeyboardBackspace';

export default function LoginPage() {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fpOpen, setFpOpen] = useState(false);
  const [fpStep, setFpStep] = useState<"request" | "code" | "password" | "success">("request");
  const [fpEmail, setFpEmail] = useState("");
  const [fpCode, setFpCode] = useState("");
  const [fpNewPass, setFpNewPass] = useState("");
  const [fpBusy, setFpBusy] = useState(false);
  const [fpMsg, setFpMsg] = useState<string | null>(null);
  const [fpErr, setFpErr] = useState<string | null>(null);
  const [fpExpiresAt, setFpExpiresAt] = useState<number | null>(null);
  const [fpRemainingSec, setFpRemainingSec] = useState<number | null>(null);

  const FP_CODE_TTL_SEC = 120;

  useEffect(() => {
    if (getAuthToken()) nav("/");
  }, [nav]);

  useEffect(() => {
    if (!fpOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeForgot();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    
  }, [fpOpen, fpBusy]);

  function openForgot() {
    setFpOpen(true);
    setFpStep("request");
    setFpEmail("");
    setFpCode("");
    setFpNewPass("");
    setFpMsg(null);
    setFpErr(null);
    setFpExpiresAt(null);
    setFpRemainingSec(null);
  }

  function closeForgot() {
    if (fpBusy) return;
    setFpOpen(false);
    setFpMsg(null);
    setFpErr(null);
    setFpExpiresAt(null);
    setFpRemainingSec(null);
  }

  function resetBackToEmail() {
    if (fpBusy) return;
    setFpStep("request");
    setFpCode("");
    setFpNewPass("");
    setFpMsg(null);
    setFpErr(null);
  }

  function goBackInReset() {
    if (fpBusy) return;
    if (fpStep === "password") {
      setFpStep("code");
      setFpErr(null);
      setFpMsg(null);
      return;
    }
    if (fpStep === "code") {
      resetBackToEmail();
      return;
    }
    if (fpStep === "success") {
      closeForgot();
    }
  }

  function goToPasswordStep() {
    setFpErr(null);
    setFpMsg(null);
    if (!/^\d{6}$/.test(fpCode.trim())) {
      setFpErr("KOD_GEÇERSİZ");
      return;
    }
    setFpStep("password");
  }

  function onCodeChange(v: string) {
    const only = String(v || "").replace(/\D+/g, "").slice(0, 6);
    setFpCode(only);
  }

  useEffect(() => {
    if (!fpOpen) return;
    if (!fpExpiresAt) {
      setFpRemainingSec(null);
      return;
    }

    const tick = () => {
      const ms = fpExpiresAt - Date.now();
      const sec = Math.max(0, Math.ceil(ms / 1000));
      setFpRemainingSec(sec);
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [fpOpen, fpExpiresAt]);

  async function resendCode() {
    
    if (!fpEmail.trim()) return;
    
    setFpMsg("Kod tekrar gönderiliyor…");
    await requestReset();
  }

  async function requestReset() {
    setFpBusy(true);
    setFpErr(null);
    
    try {
      const res = await fetch(`${API_BASE_URL}/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fpEmail }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "RESET_REQUEST_FAILED");

      const expiresInSec = Number(json?.data?.expiresInSec ?? FP_CODE_TTL_SEC);
      if (Number.isFinite(expiresInSec) && expiresInSec > 0) {
        setFpExpiresAt(Date.now() + expiresInSec * 1000);
      }

      setFpStep("code");
      if (json?.data?.rateLimited) {
        const ra = Number(json?.data?.retryAfterSec ?? 0);
        setFpMsg(`Çok sık kod istendi.${ra > 0 ? ` ${ra} sn sonra tekrar deneyebilirsin.` : ""}`);
      } else {
        setFpMsg("Kod e-posta adresine gönderildi. 2 dakika içinde şifreni değiştirebilirsin.");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "RESET_REQUEST_FAILED";
      setFpErr(msg);
    } finally {
      setFpBusy(false);
    }
  }

  async function confirmReset() {
    setFpBusy(true);
    setFpErr(null);
    
    try {
      const res = await fetch(`${API_BASE_URL}/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fpEmail, code: fpCode, newPassword: fpNewPass }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "RESET_CONFIRM_FAILED");
      setFpStep("success");
      setFpMsg("Şifren güncellendi. Şimdi giriş yapabilirsin.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "RESET_CONFIRM_FAILED";
      setFpErr(msg);
    } finally {
      setFpBusy(false);
    }
  }

  async function onSubmit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-guest-id": getOrCreateGuestId(),
        },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "LOGIN_FAILED");
      setAuthToken(json.data.token);
      identifySocket();

                
      const ag = await fetch(`${API_BASE_URL}/auth/active-game`, {
        headers: {
          Authorization: `Bearer ${json.data.token}`,
          "x-guest-id": getOrCreateGuestId(),
        },
      }).then((r) => r.json());
      const gid = ag?.data?.gameId;
      if (gid) nav(`/game/${gid}`);
      else nav("/");
    } catch (e: unknown) {
      const msg = e instanceof Error ? API_BASE_URL : "LOGIN_FAILED";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="authPage">
      <div className="authSplit">
        <AuthVisual onBack={() => nav("/")} />

        <div className="authPane">
          <div className="authCard">
            <div className="authTitle">Giriş</div>
            <div className="authSub">Hesabına giriş yap ve oyunlarına devam et.</div>

            <form
              className="authForm"
              onSubmit={(e) => {
                e.preventDefault();
                if (!loading) onSubmit();
              }}
            >
              <div className="authField">
                <label className="authLabel" htmlFor="login-username">Kullanıcı adı</label>
                <input
                  id="login-username"
                  className="authInput"
                  placeholder="örn: mirac"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  disabled={loading}
                />
              </div>

              <div className="authField">
                <label className="authLabel" htmlFor="login-password">Şifre</label>
                <input
                  id="login-password"
                  className="authInput"
                  placeholder="••••••••"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={loading}
                />
                <div className="authMetaRow">
                  <button
                    type="button"
                    className="authMetaLink"
                    onClick={openForgot}
                    disabled={loading}
                  >
                    Şifrenizi mi unuttunuz?
                  </button>
                </div>
              </div>

              {error && <div className="authError">{error}</div>}

              <div className="authActions">
                <button className="authBtn authBtn--primary" disabled={loading} type="submit">
                  {loading ? "Giriş yapılıyor…" : "Giriş yap"}
                </button>
              </div>
            </form>

            <div className="authHint">
              Hesabın yok mu?{" "}
              <button
                type="button"
                className="authLinkBtn"
                onClick={() => nav("/register")}
                disabled={loading}
              >
                Kayıt ol
              </button>
            </div>
          </div>
        </div>
      </div>

      {fpOpen && (
        <div className="authModalOverlay" role="dialog" aria-modal="true" onMouseDown={closeForgot}>
          <div className="authModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="authModal__top">
              <div className="authModal__head">
                <div className="authModal__titleRow">
                  {fpStep !== "request" && fpStep !== "success" && (
                    <button
                      type="button"
                      className="authModal__back"
                      onClick={goBackInReset}
                      disabled={fpBusy}
                      aria-label="Geri"
                      title="Geri"
                    >
                     <KeyboardBackspaceIcon sx={{ fontSize: 22 }} />  geri dön
                    </button>
                  )}
                  <div className="authModal__title">Şifre sıfırlama</div>
                </div>
                <div className="authStepper" aria-hidden="true">
                  {(() => {
                    const idx =
                      fpStep === "request" ? 0 : fpStep === "code" ? 1 : fpStep === "password" ? 2 : 3;
                    const stepClass = (i: number) => (i < idx ? "isDone" : i === idx ? "isActive" : "");
                    const lineDone = (i: number) => (idx > i ? "isDone" : "");
                    const circle = (i: number) => {
                      if (i < idx) return <span className="authStep__check">✓</span>;
                      if (i === idx) return <span className="authStep__dot" />;
                      return <span className="authStep__num">{i + 1}</span>;
                    };
                    return (
                      <>
                        <div className={`authStep ${stepClass(0)}`}>
                          <div className="authStep__circle">{circle(0)}</div>
                          <div className="authStep__label">Kod gönder</div>
                        </div>
                        <div className={`authStepper__line ${lineDone(0)}`} />
                        <div className={`authStep ${stepClass(1)}`}>
                          <div className="authStep__circle">{circle(1)}</div>
                          <div className="authStep__label">Kodu gir</div>
                        </div>
                        <div className={`authStepper__line ${lineDone(1)}`} />
                        <div className={`authStep ${stepClass(2)}`}>
                          <div className="authStep__circle">{circle(2)}</div>
                          <div className="authStep__label">Şifre değiştir</div>
                        </div>
                        <div className={`authStepper__line ${lineDone(2)}`} />
                        <div className={`authStep ${stepClass(3)}`}>
                          <div className="authStep__circle">{circle(3)}</div>
                          <div className="authStep__label">Başarılı</div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
              
            </div>
            <button className="authModal__close" type="button" onClick={closeForgot} aria-label="Kapat">
                ×
              </button>
            

            <div className="authModal__body">
              {(fpStep === "code" || fpStep === "password" || fpStep === "success") && (
                <div className="authModalHero" aria-hidden="true">
                  <div className="authModalHero__icon">
                    <img
                      src={fpStep === "code" ? "/auth/7.svg" : fpStep === "password" ? "/auth/5.svg" : "/auth/6.svg"}
                      alt=""
                    />
                  </div>
                </div>
              )}

              {fpStep === "request" ? (
                <div className="authField">
                  <label className="authLabel" htmlFor="fp-email">E-posta</label>
                  <input
                    id="fp-email"
                    className="authInput"
                    placeholder="ad@site.com"
                    value={fpEmail}
                    onChange={(e) => setFpEmail(e.target.value)}
                    autoComplete="email"
                    disabled={fpBusy}
                  />
                </div>
              ) : fpStep === "success" ? (
                <div className="authSuccess">
                  <div className="authSuccess__title">Başarılı</div>
                  <div className="authSuccess__desc">{fpMsg || "Şifren güncellendi."}</div>
                </div>
              ) : (
                <div className="authInlineMeta">
                  <div className="authInlineMeta__label">Gönderilen e-posta</div>
                  <div className="authInlineMeta__value">{fpEmail}</div>
                  {fpStep === "code" && (
                    <button type="button" className="authInlineMeta__link" onClick={resendCode} disabled={fpBusy}>
                      Tekrar kod gönder
                    </button>
                  )}
                </div>
              )}

              {fpStep === "code" && fpExpiresAt && fpRemainingSec != null && (
                <div className="authCountdownRow" aria-hidden="true">
                  {(() => {
                    const total = FP_CODE_TTL_SEC;
                    const remain = Math.max(0, fpRemainingSec);
                    const frac = total > 0 ? Math.max(0, Math.min(1, remain / total)) : 0;
                    const r = 34;
                    const c = 2 * Math.PI * r;
                    const dash = c;
                    const offset = c * (1 - frac);
                    const mm = String(Math.floor(remain / 60));
                    const ss = String(remain % 60).padStart(2, "0");
                    return (
                      <div className="authCountdown">
                        <svg width="84" height="84" viewBox="0 0 84 84">
                          <circle className="authCountdown__bg" cx="42" cy="42" r={r} />
                          <circle
                            className="authCountdown__fg"
                            cx="42"
                            cy="42"
                            r={r}
                            strokeDasharray={dash}
                            strokeDashoffset={offset}
                          />
                          <text className="authCountdown__text" x="42" y="46" textAnchor="middle">
                            {mm}:{ss}
                          </text>
                        </svg>
                      </div>
                    );
                  })()}
                </div>
              )}

              {fpStep === "code" && (
                <div className="authField">
                    <label className="authLabel" htmlFor="fp-code">Kod</label>
                    <div
                      className="authOtp"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const el = document.getElementById("fp-code") as HTMLInputElement | null;
                        el?.focus();
                      }}
                    >
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div
                          key={i}
                          className={`authOtp__box ${fpCode.length === i ? "isActive" : ""} ${fpCode.length > i ? "isFilled" : ""}`}
                        >
                          {fpCode[i] ?? ""}
                        </div>
                      ))}
                      <input
                        id="fp-code"
                        className="authOtp__input"
                        value={fpCode}
                        onChange={(e) => onCodeChange(e.target.value)}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        disabled={fpBusy}
                        aria-label="6 haneli kod"
                      />
                    </div>
                    {fpMsg && <div className="authNote">{fpMsg}</div>}
                </div>
              )}

              {fpStep === "password" && (
                <div className="authField">
                    <label className="authLabel" htmlFor="fp-pass">Yeni şifre</label>
                    <input
                      id="fp-pass"
                      className="authInput"
                      placeholder="en az 6 karakter"
                      type="password"
                      value={fpNewPass}
                      onChange={(e) => setFpNewPass(e.target.value)}
                      autoComplete="new-password"
                      disabled={fpBusy}
                    />
                </div>
              )}

              {fpErr && <div className="authError">{fpErr}</div>}
              {fpMsg && fpStep !== "code" && fpStep !== "success" && <div className="authInfo">{fpMsg}</div>}

              <div className="authActions">
                {fpStep === "request" && (
                  <button
                    className="authBtn authBtn--primary"
                    type="button"
                    onClick={requestReset}
                    disabled={fpBusy || !fpEmail.trim()}
                  >
                    {fpBusy ? "Gönderiliyor…" : "Kod gönder"}
                  </button>
                )}

                {fpStep === "code" && (
                  <button
                    className="authBtn authBtn--primary"
                    type="button"
                    onClick={goToPasswordStep}
                    disabled={fpBusy || fpCode.trim().length !== 6 || fpRemainingSec === 0}
                  >
                    Devam
                  </button>
                )}
                
                {fpStep === "password" && (
                  <button
                    className="authBtn authBtn--primary"
                    type="button"
                    onClick={confirmReset}
                    disabled={fpBusy || fpCode.trim().length !== 6 || fpNewPass.length < 6}
                  >
                    {fpBusy ? "Güncelleniyor…" : "Şifreyi değiştir"}
                  </button>
                )}

                {fpStep === "success" && (
                  <button className="authBtn authBtn--primary" type="button" onClick={closeForgot} disabled={fpBusy}>
                    Kapat
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

