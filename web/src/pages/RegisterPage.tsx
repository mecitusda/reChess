import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuthToken, setAuthToken, getOrCreateGuestId } from "../auth/auth";
import { identifySocket } from "../socket/socket";
import "./css/authPage.css";
import AuthVisual from "./AuthVisual";

export default function RegisterPage() {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getAuthToken()) nav("/");
  }, [nav]);

  async function onSubmit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:4000/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-guest-id": getOrCreateGuestId(),
        },
        body: JSON.stringify({ username, email, password }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "REGISTER_FAILED");
      setAuthToken(json.data.token);
      identifySocket();

      const ag = await fetch("http://localhost:4000/auth/active-game", {
        headers: {
          Authorization: `Bearer ${json.data.token}`,
          "x-guest-id": getOrCreateGuestId(),
        },
      }).then((r) => r.json());
      const gid = ag?.data?.gameId;
      if (gid) nav(`/game/${gid}`);
      else nav("/");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "REGISTER_FAILED";
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
            <div className="authTitle">Kayıt ol</div>
            <div className="authSub">Yeni bir hesap oluştur ve maçlarını kaydet.</div>

            <form
              className="authForm"
              onSubmit={(e) => {
                e.preventDefault();
                if (!loading) onSubmit();
              }}
            >
              <div className="authField">
                <label className="authLabel" htmlFor="reg-username">Kullanıcı adı</label>
                <input
                  id="reg-username"
                  className="authInput"
                  placeholder="en az 3 karakter"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  disabled={loading}
                />
              </div>

              <div className="authField">
                <label className="authLabel" htmlFor="reg-email">E-posta</label>
                <input
                  id="reg-email"
                  className="authInput"
                  placeholder="örn: ad@site.com (şifre sıfırlama için)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  disabled={loading}
                />
              </div>

              <div className="authField">
                <label className="authLabel" htmlFor="reg-password">Şifre</label>
                <input
                  id="reg-password"
                  className="authInput"
                  placeholder="en az 6 karakter"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={loading}
                />
              </div>

              {error && <div className="authError">{error}</div>}

              <div className="authActions">
                <button className="authBtn authBtn--primary" disabled={loading} type="submit">
                  {loading ? "Oluşturuluyor…" : "Kayıt ol"}
                </button>
              </div>
            </form>

            <div className="authHint">
              Zaten hesabın var mı?{" "}
              <button
                type="button"
                className="authLinkBtn"
                onClick={() => nav("/login")}
                disabled={loading}
              >
                Giriş yap
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

