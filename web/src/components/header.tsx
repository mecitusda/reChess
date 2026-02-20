import "./css/Header.css";
import { useEffect, useRef, useState } from "react";
import { AUTH_CHANGED_EVENT, clearAuthToken, getAuthToken, getOrCreateGuestName, getOrCreateGuestId } from "../auth/auth";
import { NavLink, useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../config";
import Avatar from '@mui/material/Avatar';
type NavItem = {
  label: string;
  to: string;
};

const navItems: NavItem[] = [
  { label: "Lobi", to: "/" },
];


function stringToColor(string: string) {
  let hash = 0;
  let i;

  for (i = 0; i < string.length; i += 1) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }

  let color = '#';

  for (i = 0; i < 3; i += 1) {
    const value = (hash >> (i * 8)) & 0xff;
    color += `00${value.toString(16)}`.slice(-2);
  }

  return color;
}

function stringAvatar(name: string) {
  return {
    sx: {
      bgcolor: stringToColor(name),
    },
    children: `${name.split(' ')[0][0]}${name.split(' ')[1] ? name.split(' ')[1][0] : ""}`,
  };
} 
export default function Header() {
  const nav = useNavigate();
  const [token, setToken] = useState<string | null>(getAuthToken());
  const [displayName, setDisplayName] = useState<string>(getOrCreateGuestName());
  const [menuOpen, setMenuOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  async function refreshName(nextToken: string | null) {
    if (!nextToken) {
      setDisplayName(getOrCreateGuestName());
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${nextToken}`,
          "x-guest-id": getOrCreateGuestId(),
        },
      });
      const json = await res.json();
      if (json?.ok) setDisplayName(json.data.username);
      else setDisplayName(getOrCreateGuestName());
    } catch {
      setDisplayName(getOrCreateGuestName());
    }
  }

  useEffect(() => {

    refreshName(token);

    const onAuthChanged = () => {
      const next = getAuthToken();
      setToken(next);
      refreshName(next);
    };

    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    window.addEventListener("storage", onAuthChanged);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
      window.removeEventListener("storage", onAuthChanged);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };

    const onPointerDown = (e: PointerEvent) => {
      const root = menuWrapRef.current;
      if (!root) return;
      const t = e.target as Node | null;
      if (!t) return;
      if (!root.contains(t)) setMenuOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  useEffect(() => {
 
    if (menuOpen) {
      setHidden(false);
      return;
    }

    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const y = window.scrollY || 0;

        const shouldHide = y >= 8;
        setHidden((prev) => (prev === shouldHide ? prev : shouldHide));
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [menuOpen]);

  return (
    <header className={`header ${hidden ? "header--hidden" : ""}`}>
      <div className="header__inner">
      
        <div className="header-left">
          <button className="brandBtn" type="button" onClick={() => nav("/")}>
            <span className="logo" aria-hidden="true">♞</span>
            <span className="brand">reChess</span>
          </button>

          <nav className="nav" aria-label="Ana menü">
            {navItems.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                className={({ isActive }) => `navLink ${isActive ? "isActive" : ""}`}
              >
                {item.label}
              </NavLink>
            ))}
            <button
              type="button"
              className="navLink"
              onClick={() => nav("/", { state: { qa: "create" } })}
            >
              Oyun kur
            </button>
            <button
              type="button"
              className="navLink"
              onClick={() => nav("/", { state: { qa: "join" } })}
            >
              Katıl
            </button>
          </nav>
        </div>

        <div className="header-right">
          
          <div className="userMenuWrap" ref={menuWrapRef}>
            <button
              type="button"
              className="userBtn"
              aria-haspopup={token ? "menu" : undefined}
              aria-expanded={token ? menuOpen : undefined}
              onClick={() => {
                if (!token) {
                  nav("/login");
                  return;
                }
                setMenuOpen((v) => !v);
              }}
              title={token ? "Hesap menüsü" : "Giriş yap"}
            >
              <Avatar {...stringAvatar(displayName)} style={{ width: 30, height: 30, fontSize: 20, color: "white" }}/>
              <span className="username">{displayName}</span>
            </button>

            {token && menuOpen && (
              <div className="userMenu" role="menu" aria-label="Hesap">
                <button
                  type="button"
                  className="userMenu__item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    nav(`/u/${encodeURIComponent(displayName)}`);
                  }}
                >
                  Profilim
                </button>
                <button
                  type="button"
                  className="userMenu__item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    nav("/games");
                  }}
                >
                  Oyunlarım
                </button>
                <button
                  type="button"
                  className="userMenu__item userMenu__item--danger"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    clearAuthToken();
                    nav("/");
                  }}
                >
                  Çıkış yap
                </button>
              </div>
            )}
          </div>

          {!token && (
            <button type="button" className="btn btn--primary" onClick={() => nav("/login")}>
              Giriş
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
