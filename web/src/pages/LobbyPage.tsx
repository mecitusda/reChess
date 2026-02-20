
import TimeControlGrid from "../components/lobby/TimeControlGrid";
import QuickActions from "../components/lobby/QuickActions";
import LobbyLeftPanel from "../components/lobby/LobbyLeftPanel";
import { TIME_CONTROLS } from "../constants/timeControls";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { socket } from "../socket/socket";
import { getAuthToken, getOrCreateGuestId } from "../auth/auth";

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
import "./css/lobby.css";
export default function LobbyPage() {
  const [searching, setSearching] = useState(false);
  const [joinPending, setJoinPending] = useState(false);
  const [queueInfo, setQueueInfo] = useState<{ initial: number; increment: number } | null>(null);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [netNotice, setNetNotice] = useState<string | null>(null);
  const [qaRequest, setQaRequest] = useState<"create" | "join" | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [stats, setStats] = useState<null | {
    allTime: { total: number; w: number; l: number; d: number; winRate: number };
    last7: { total: number; w: number; l: number; d: number; winRate: number };
    last30: { total: number; w: number; l: number; d: number; winRate: number };
    mostPlayed: null | { timeControl: string; count: number };
    tcDist: { timeControl: string; count: number }[];
    last30Daily: { day: string; w: number; l: number; d: number; total: number }[];
    avgDurationSec: number;
    avgMoves: number;
  }>(null);
  const [hoverTip, setHoverTip] = useState<{ show: boolean; x: number; y: number }>({
    show: false,
    x: 0,
    y: 0,
  });
  const navigate = useNavigate();
  const location = useLocation();
  const ackTimerRef = useRef<number | null>(null);

  
  useEffect(() => {
    const qa = (location.state as { qa?: "create" | "join" } | null)?.qa;
    if (qa !== "create" && qa !== "join") return;
    setQaRequest(qa);
    
    navigate("/", { replace: true, state: null });
  }, [location.state]);

  function clearAckTimer() {
    if (ackTimerRef.current != null) {
      window.clearTimeout(ackTimerRef.current);
      ackTimerRef.current = null;
    }
  }

  function flashNotice(msg: string) {
    setNetNotice(msg);
    window.setTimeout(() => {
      setNetNotice((cur) => (cur === msg ? null : cur));
    }, 2200);
  }

  function joinQueue(initial: number, increment: number) {
    
    if (!socket.connected) {
      flashNotice("Sunucuya bağlanılamadı. Lütfen tekrar dene.");
      return;
    }

    clearAckTimer();
    setJoinPending(true);
    setQueueInfo({ initial, increment });
    socket.emit("queue:join", { initial, increment });

    
    ackTimerRef.current = window.setTimeout(() => {
      setJoinPending(false);
      setSearching(false);
      setQueueInfo(null);
      flashNotice("Sunucudan yanıt alınamadı. Tekrar dene.");
      ackTimerRef.current = null;
    }, 2500);
  }

  function leaveQueue() {
    socket.emit("queue:leave");
    setSearching(false);
    setJoinPending(false);
    setQueueInfo(null);
    clearAckTimer();
  }

  useEffect(() => {
    
    const refreshActiveGame = async () => {
      try {
        const token = getAuthToken();
        const res = await fetch("http://localhost:4000/auth/active-game", {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "x-guest-id": getOrCreateGuestId(),
          },
        });
        const json = await res.json();
        setActiveGameId(json?.data?.gameId ?? null);
      } catch {
        setActiveGameId(null);
      }
    };

    refreshActiveGame();

    const onQueueWaiting = () => {
      clearAckTimer();
      setJoinPending(false);
      setSearching(true);
    };

    const onQueueMatched = ({ gameId }: { gameId: string }) => {
      clearAckTimer();
      setJoinPending(false);
      setSearching(false);
      navigate(`/game/${gameId}`);
    };

    const onQueueBlocked = (p: { reason: string; gameId?: string }) => {
      clearAckTimer();
      setJoinPending(false);
      setSearching(false);
      setQueueInfo(null);
      if (p?.reason === "ACTIVE_GAME") {
        if (p.gameId) setActiveGameId(p.gameId);
      }
    };

    const onConnect = () => {
      setNetNotice(null);
    };

    const onDisconnect = () => {
      clearAckTimer();
      setJoinPending(false);
      setSearching(false);
      setQueueInfo(null);
      flashNotice("Sunucu bağlantısı koptu.");
    };

    const onConnectError = () => {
      clearAckTimer();
      setJoinPending(false);
      setSearching(false);
      setQueueInfo(null);
      flashNotice("Sunucuya bağlanılamadı.");
    };

    const onFocus = () => {
      
      refreshActiveGame();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshActiveGame();
    };

    socket.on("queue:waiting", onQueueWaiting);
    socket.on("queue:matched", onQueueMatched);
    socket.on("queue:blocked", onQueueBlocked);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      socket.off("queue:waiting", onQueueWaiting);
      socket.off("queue:matched", onQueueMatched);
      socket.off("queue:blocked", onQueueBlocked);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      clearAckTimer();
    };
  }, []);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;

    let alive = true;
    (async () => {
      setStatsLoading(true);
      setStatsError(null);
      try {
        const res = await fetch("http://localhost:4000/stats/me", {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-guest-id": getOrCreateGuestId(),
          },
        });
        const json = await res.json();
        if (!alive) return;
        if (!json?.ok) throw new Error(json?.error || "STATS_FAILED");
        setStats(json.data);
      } catch (e: unknown) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : "STATS_FAILED";
        setStatsError(msg);
        setStats(null);
      } finally {
        if (alive) setStatsLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  function updateTipFromEvent(e: React.MouseEvent) {
    if (!activeGameId) return;
    const t = e.target as HTMLElement | null;
    const hit = t?.closest?.(".time-card, .quick-actions button");
    if (!hit) {
      setHoverTip((p) => (p.show ? { ...p, show: false } : p));
      return;
    }

    const tipW = 280;
    const tipH = 64;
    const left = Math.min(window.innerWidth - tipW - 12, e.clientX + 12);
    const top = Math.min(window.innerHeight - tipH - 12, e.clientY + 12);
    setHoverTip({ show: true, x: Math.max(12, left), y: Math.max(12, top) });
  }

  const searchingKey =
    queueInfo && (searching || joinPending) ? `${queueInfo.initial}+${queueInfo.increment}` : null;

  const pieData = stats
    ? [
        { name: "Win", value: stats.last30.w },
        { name: "Loss", value: stats.last30.l },
        { name: "Draw", value: stats.last30.d },
      ]
    : [];
  const pieColors = ["#22c55e", "#ef4444", "#94a3b8"];
  const RADIAN = Math.PI / 180;

  const renderPiePercent = (p: any) => {
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
    const txt = `${pct}%`;

    return (
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fill="rgba(255,255,255,0.92)"
        style={{ fontSize: 12, fontWeight: 950 }}
      >
        {txt}
      </text>
    );
  };

  const rawDaily = stats?.last30Daily || [];
  const dailyView = (() => {
    if (!rawDaily.length) return rawDaily;
    const firstNonZero = rawDaily.findIndex((r) => (r?.total || 0) > 0);
    if (firstNonZero === -1) {
      
      return rawDaily.slice(Math.max(0, rawDaily.length - 14));
    }
    
    let v = rawDaily.slice(Math.max(0, firstNonZero - 2));
    
    if (v.length < 8) v = rawDaily.slice(Math.max(0, rawDaily.length - 8));
    return v;
  })();

  const dailyData = dailyView.map((r) => ({
    ...r,
    label: String(r.day || "").slice(5), 
  }));
  const dailyDaysLabel = dailyData.length ? `Son ${dailyData.length} gün` : "Son 30 gün";

  return (
    <>
    <h1 className="lobby__title">Hızlı eşleşme</h1>
    <div
      className="lobby"
      onMouseMove={updateTipFromEvent}
      onMouseLeave={() => setHoverTip((p) => (p.show ? { ...p, show: false } : p))}
    >
      <div className="lobby__left">
        <LobbyLeftPanel activeGameId={activeGameId} onActiveGameIdChange={setActiveGameId} />
      </div>
      <div className="lobby__middle">

        <TimeControlGrid
        timeControls={TIME_CONTROLS}
        searchingKey={searchingKey}
        onSelect={(tc) => {
          if (activeGameId) {
            return;
          }
          if (tc.id === "custom" || tc.speed === "custom") {
            setQaRequest("create");
            return;
          }


          if (searchingKey && searchingKey === `${tc.initial}+${tc.increment}`) {
            leaveQueue();
            return;
          }
            
          if (searching || joinPending) {
            leaveQueue();
            window.setTimeout(() => joinQueue(tc.initial, tc.increment), 60);
            return;
          }

          joinQueue(tc.initial, tc.increment);
        }}
      />
        
      </div>
      <div className="lobby__right">
        <QuickActions
          blocked={!!activeGameId}
          requestOpen={qaRequest}
          onRequestConsumed={() => setQaRequest(null)}
        />
      </div>
     
     
      


    </div>

    

    <section className="homeStats">
      <div className="homeStats__inner">
        <div className="homeStats__card">
          
          {!getAuthToken() ? (
            <div className="homeStats__text">İstatistiklerini görmek için giriş yap.</div>
          ) : statsLoading ? (
            <div className="homeStats__text">
                <div className="spinner" />
            </div>
          ) : statsError ? (
            null
          ) : !stats ? (
            <div className="homeStats__text">Henüz veri yok.</div>
          ) : (
            <>
            <div className="homeStats__title">İstatistikler</div>
            <div className="homeCharts">
              <div className="homeChartCard">
                <div className="homeChartCard__head">
                  <div className="homeChartCard__title">{dailyDaysLabel}</div>
                  <div className="homeChartCard__meta">{stats.last30.w + stats.last30.l + stats.last30.d} oyun</div>
                </div>
                <div className="homeChartCard__chart">
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
                          color: "rgb(255, 255, 255)",
                          boxShadow: "0 18px 55px rgba(0,0,0,0.45)",
                        }}
                        labelStyle={{ color: "rgba(255,255,255,0.70)" }}
                      />
                      <Bar dataKey="w" stackId="a" fill="#22c55e" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="d" stackId="a" fill="#94a3b8" />
                      <Bar dataKey="l" stackId="a" fill="#ef4444" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="homeChartCard__legend">
                  <span className="lg"><i style={{ background: "#22c55e" }} /> Win</span>
                  <span className="lg"><i style={{ background: "#94a3b8" }} /> Draw</span>
                  <span className="lg"><i style={{ background: "#ef4444" }} /> Loss</span>
                </div>
              </div>

              <div className="homeChartCard">
                <div className="homeChartCard__head">
                  <div className="homeChartCard__title">Dağılım</div>
                  
                </div>
                <div className="homeChartCard__split">
                  <div className="homeChartCard__chart homeChartCard__chart--pie">
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
                          {stats.last30.total > 0 && (
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
                                      %{stats.last30.winRate}
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
                  <div className="homeChartCard__side">
                    <div className="homeMini">
                      <div className="homeMini__k">Son 7 gün</div>
                      <div className="homeMini__v">{stats.last7.w}-{stats.last7.l}-{stats.last7.d}</div>
                    </div>
                    <div className="homeMini">
                      <div className="homeMini__k">En çok tempo</div>
                      <div className="homeMini__v">{stats.mostPlayed?.timeControl ?? "-"}</div>
                    </div>
                  </div>
                </div>

                {stats.tcDist?.length ? (
                  <div className="homeTcRow">
                    {stats.tcDist.map((t) => (
                      <div key={t.timeControl} className="homeTcPill">
                        <span className="homeTcPill__tc">{t.timeControl}</span>
                        <span className="homeTcPill__n">{t.count}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            </>
          )}  
        </div>
      </div>
    </section>

    <section className="homeExtra">
      <div className="homeExtra__inner">
        <div className="homeExtra__card">
          <div className="homeExtra__title">İpucu</div>
          <div className="homeExtra__text">
            Hızlı eşleşmeye girmeden önce açılışlarını gözden geçir. Hamle geçmişinde maçları
            tekrar açıp analiz edebilirsin.
          </div>
        </div>

        <div className="homeExtra__card">
          <div className="homeExtra__title">Yakında</div>
          <div className="homeExtra__text">Günün bulmacası ve analiz modu.</div>
        </div>
      </div>
    </section>

    {activeGameId && hoverTip.show && (
      <div className="hoverTip" style={{ left: hoverTip.x, top: hoverTip.y }}>
        Aktif maçın var. Yeni eşleşmeye girmek için maçı bitir veya <b>Terket</b>.
      </div>
    )}
    {netNotice && (
      <div className="netTip" role="status" aria-live="polite">
        {netNotice}
      </div>
    )}
      </>
  );
}
