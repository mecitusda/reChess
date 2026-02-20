import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { getAuthToken, getOrCreateGuestId } from "../auth/auth";
import { API_BASE_URL } from "../config";
import { socket } from "../socket/socket";
import {
  Bar,
  BarChart,
  Cell,
  Label,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./css/profilePage.css";
import Avatar from '@mui/material/Avatar';
type ProfileStats = {
  allTime: { total: number; w: number; l: number; d: number; winRate: number };
  last7: { total: number; w: number; l: number; d: number; winRate: number };
  last30: { total: number; w: number; l: number; d: number; winRate: number };
  mostPlayed: null | { timeControl: string; count: number };
  tcDist: { timeControl: string; count: number }[];
  last30Daily: { day: string; w: number; l: number; d: number; total: number }[];
  avgDurationSec: number;
  avgMoves: number;
};

type ProfileData = {
  user: { username: string; joinedAt: string; country: string; online?: boolean; lastActiveAt?: number | null };
  ratings: {
    bullet: null | { rating: number; rd: number; provisional: boolean; games: number };
    blitz: null | { rating: number; rd: number; provisional: boolean; games: number };
    rapid: null | { rating: number; rd: number; provisional: boolean; games: number };
    classical: null | { rating: number; rd: number; provisional: boolean; games: number };
  };
  stats: ProfileStats;
  recentGames: {
    gameId: string;
    createdAt: string;
    timeControl: string;
    opponentName: string;
    result: "win" | "loss" | "draw";
    reason: string;
  }[];
};

function stringToColor(string: string) {
  let hash = 0;
  let i;

  /* eslint-disable no-bitwise */
  for (i = 0; i < string.length; i += 1) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }

  let color = '#';

  for (i = 0; i < 3; i += 1) {
    const value = (hash >> (i * 8)) & 0xff;
    color += `00${value.toString(16)}`.slice(-2);
  }
  /* eslint-enable no-bitwise */

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

const RADIAN = Math.PI / 180;
const pieColors = ["#22c55e", "#ef4444", "#94a3b8"];

function renderPiePercent(p: any) {
  const percent = Number(p?.percent || 0);
  const pct = Math.round(percent * 100);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  const cx = Number(p?.cx || 0);
  const cy = Number(p?.cy || 0);
  const midAngle = Number(p?.midAngle || 0);
  const innerRadius = Number(p?.innerRadius || 0);
  const outerRadius = Number(p?.outerRadius || 0);
  const r = innerRadius + (outerRadius - innerRadius) * 0.42;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      fill="rgba(255,255,255,0.92)"
      style={{ fontSize: 12, fontWeight: 950 }}
    >
      {pct}%
    </text>
  );
}

function normalizeUsername(u: string) {
  return String(u || "").trim().toLowerCase().replace(/\s+/g, "");
}

/** Son aktif zamanı metne çevirir */
function formatLastActive(ts: number): string {
  const now = Date.now();
  const diffMs = now - ts;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return "Az önce";
  if (diffMin < 60) return `${diffMin} dakika önce`;
  if (diffHour < 24) return `${diffHour} saat önce`;
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (diffDay === 1 || (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth())) {
    return `Dün ${d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (diffDay < 7) return `${diffDay} gün önce`;
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ProfilePage() {
  const { username: raw } = useParams();
  const username = String(raw || "").trim();
  const normalizedUsername = normalizeUsername(username);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProfileData | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [lastActiveAt, setLastActiveAt] = useState<number | null>(null);
  useEffect(() => {
    if (!normalizedUsername) return;
    socket.emit("presence:subscribe", { username: normalizedUsername });
    const onStatus = (p: { username: string; online: boolean; lastActiveAt?: number }) => {
      if (normalizeUsername(p.username) === normalizedUsername) {
        setIsOnline(p.online);
        if (p.lastActiveAt != null) setLastActiveAt(p.lastActiveAt);
      }
    };
    const onOnline = (p: { username: string }) => {
      if (normalizeUsername(p.username) === normalizedUsername) setIsOnline(true);
    };
    const onOffline = (p: { username: string; lastActiveAt?: number }) => {
      if (normalizeUsername(p.username) === normalizedUsername) {
        setIsOnline(false);
        if (p.lastActiveAt != null) setLastActiveAt(p.lastActiveAt);
      }
    };
    socket.on("presence:status", onStatus);
    socket.on("presence:online", onOnline);
    socket.on("presence:offline", onOffline);
    return () => {
      socket.emit("presence:unsubscribe", { username: normalizedUsername });
      socket.off("presence:status", onStatus);
      socket.off("presence:online", onOnline);
      socket.off("presence:offline", onOffline);
    };
  }, [normalizedUsername]);

  useEffect(() => {
    if (!username) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const token = getAuthToken();
        const res = await fetch(`${API_BASE_URL}/users/${encodeURIComponent(username)}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "x-guest-id": getOrCreateGuestId(),
          },
        });
        const json = await res.json();
        if (!alive) return;
        if (!json?.ok) throw new Error(json?.error || "PROFILE_FAILED");
        setData(json.data);
        if (json.data?.user?.online != null) setIsOnline(!!json.data.user.online);
        if (json.data?.user?.lastActiveAt != null) setLastActiveAt(json.data.user.lastActiveAt);
      } catch (e: unknown) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : "PROFILE_FAILED";
        setError(msg);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [username]);

  const dailyData = useMemo(() => {
    const rawDaily = data?.stats?.last30Daily || [];
    return rawDaily.map((r) => ({ ...r, label: String(r.day || "").slice(5) }));
  }, [data]);

  const pieData = useMemo(() => {
    const s = data?.stats;
    if (!s) return [];
    return [
      { name: "Win", value: s.last30.w },
      { name: "Loss", value: s.last30.l },
      { name: "Draw", value: s.last30.d },
    ];
  }, [data]);

  const joined = data?.user?.joinedAt ? new Date(data.user.joinedAt).toLocaleDateString() : "";
  const r = data?.ratings;

  return (
    <div className="profilePage">
      <div className="profileHero">
        <div className="profileHero__left">
          <Avatar {...stringAvatar(username)} style={{ width: 64, height: 64, fontSize: 24, color: "white" }}/>
          <div className="profileHero__info">
          <div className="profileName profileName--big">
          <span
              className={`presenceDot profileDot ${isOnline ? "presenceDot--online" : "presenceDot--offline"}`}
              title={isOnline ? "Çevrimiçi" : "Çevrimdışı"}
            />
            {data?.user?.username || username}
             
            {isOnline && <span className="lastActive">Çevrimiçi</span>}
               {!isOnline && lastActiveAt != null && (
                <span className="lastActive">Son çevrimiçi: {formatLastActive(lastActiveAt)}</span>
              )}
            
           
          </div>
            <div className="profileMeta">
              
              <span>Üyelik Tarihi: {joined || "-"}</span>
              {data?.stats?.allTime?.total ? (
                <>
                  <span className="dot">•</span>
                  <span>{data.stats.allTime.total} oyun</span>
                  <span className="dot">•</span>
                  <span><img src={`https://flagcdn.com/24x18/${data?.user?.country?.toLowerCase()}.png`} alt={data.user.country}/></span>
                  <span>{data.user.country} </span>
                  
                    
                </>
              ) : null}
            </div>
          </div>
        </div>
        
      </div>

      {loading && <div className="profileCard">Yükleniyor…</div>}
      {error && <div className="profileCard">Yüklenemedi: {error}</div>}

      {data && (
        <div className="profileGrid">
          <div className="profileCard">
            <div className="profileCard__title">Özet</div>
            <div className="profileKpis">
              <div className="kpi">
                <div className="kpi__k">Tüm zamanlar</div>
                <div className="kpi__v">
                  {data.stats.allTime.w}-{data.stats.allTime.l}-{data.stats.allTime.d}
                </div>
                <div className="kpi__s">%{data.stats.allTime.winRate} win</div>
              </div>
              <div className="kpi">
                <div className="kpi__k">Son 30 gün</div>
                <div className="kpi__v">
                  {data.stats.last30.w}-{data.stats.last30.l}-{data.stats.last30.d}
                </div>
                <div className="kpi__s">%{data.stats.last30.winRate} win</div>
              </div>
              <div className="kpi">
                <div className="kpi__k">En çok tempo</div>
                <div className="kpi__v">{data.stats.mostPlayed?.timeControl ?? "-"}</div>
                <div className="kpi__s">{data.stats.mostPlayed ? `${data.stats.mostPlayed.count} oyun` : ""}</div>
              </div>
            </div>
          </div>

          <div className="profileCard">
            <div className="profileCard__title">Rating</div>
            <div className="profileRatings">
              {(["bullet", "blitz", "rapid", "classical"] as const).map((speed) => {
                const rr = r?.[speed] || null;
                const title =
                  speed === "bullet" ? "Bullet" : speed === "blitz" ? "Blitz" : speed === "rapid" ? "Rapid" : "Klasik";
                return (
                  <div key={speed} className="ratingTile">
                    <div className="ratingTile__k">{title}</div>
                    <div className="ratingTile__v">{rr ? rr.rating : "-"}</div>
                    <div className="ratingTile__s">
                      {rr
                        ? `${rr.games} oyun${rr.provisional ? " • ?" : ""}`
                        : "Henüz yok"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="profileCard profileCard--wide">
            <div className="profileCard__title">Aktivite (30 gün)</div>
            <div className="profileChart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }} interval={4} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    wrapperStyle={{ opacity: 1, filter: "none" }}
                    contentStyle={{
                      background: "rgba(24, 28, 36, 0.96)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 10,
                      color: "rgba(255,255,255,0.90)",
                      boxShadow: "0 18px 55px rgba(0,0,0,0.45)",
                    }}
                    labelStyle={{ color: "rgba(255,255,255,0.75)" }}
                    itemStyle={{ color: "rgba(255,255,255,0.92)" }}
                  />
                  <Bar dataKey="w" stackId="a" fill="#22c55e" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="d" stackId="a" fill="#94a3b8" />
                  <Bar dataKey="l" stackId="a" fill="#ef4444" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="profileCard">
            <div className="profileCard__title">Dağılım (30 gün)</div>
            <div className="profileDonut">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="62%"
                    outerRadius="88%"
                    paddingAngle={2}
                    cornerRadius={8}
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth={1}
                    labelLine={false}
                    label={renderPiePercent}
                  >
                    {data.stats.last30.total > 0 && (
                      <Label
                        position="center"
                        content={({ viewBox }) => {
                          const vb = viewBox as any;
                          const cx =
                            vb?.cx ??
                            (typeof vb?.x === "number" && typeof vb?.width === "number"
                              ? vb.x + vb.width / 2
                              : 0);
                          const cy =
                            vb?.cy ??
                            (typeof vb?.y === "number" && typeof vb?.height === "number"
                              ? vb.y + vb.height / 2
                              : 0);
                          return (
                            <g>
                              <text
                                x={cx}
                                y={cy - 2}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fill="rgba(255,255,255,0.92)"
                                style={{ fontSize: 18, fontWeight: 950 }}
                              >
                                %{data.stats.last30.winRate}
                              </text>
                              <text
                                x={cx}
                                y={cy + 16}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fill="rgba(255,255,255,0.62)"
                                style={{ fontSize: 11, fontWeight: 850, letterSpacing: "0.08em" }}
                              >
                                WIN
                              </text>
                            </g>
                          );
                        }}
                      />
                    )}
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={pieColors[i] || "#94a3b8"} />
                    ))}
                  </Pie>
                  <Tooltip
                    wrapperStyle={{ opacity: 1, filter: "none" }}
                    contentStyle={{
                      background: "rgba(24, 28, 36, 0.96)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 10,
                      color: "rgba(255,255,255,0.90)",
                      boxShadow: "0 18px 55px rgba(0,0,0,0.45)",
                    }}
                    itemStyle={{ color: "rgba(255,255,255,0.92)" }}
                    labelStyle={{ color: "rgba(255,255,255,0.75)" }}
                  />
                </PieChart> 
              </ResponsiveContainer>
            </div>
            {data.stats.tcDist?.length ? (
              <div className="profileTcRow">
                {data.stats.tcDist.map((t) => (
                  <div key={t.timeControl} className="profileTcPill">
                    <span className="profileTcPill__tc">{t.timeControl}</span>
                    <span className="profileTcPill__n">{t.count}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

     
        </div>
      )}
    </div>
  );
}

