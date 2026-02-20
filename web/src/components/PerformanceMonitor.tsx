import { useEffect, useState, useRef } from "react";

const STORAGE_KEY = "perfMonitor";

const THRESHOLDS = {
  fpsGood: 55,
  fpsOk: 30,
  frameMsGood: 18,
  frameMsOk: 33,
  memoryMbGood: 150,
  memoryMbOk: 400,
} as const;

type Level = "good" | "ok" | "bad";

function fpsLevel(fps: number): Level {
  if (fps >= THRESHOLDS.fpsGood) return "good";
  if (fps >= THRESHOLDS.fpsOk) return "ok";
  return "bad";
}

function frameMsLevel(ms: number): Level {
  if (ms <= THRESHOLDS.frameMsGood) return "good";
  if (ms <= THRESHOLDS.frameMsOk) return "ok";
  return "bad";
}

function memoryLevel(mb: number): Level {
  if (mb <= THRESHOLDS.memoryMbGood) return "good";
  if (mb <= THRESHOLDS.memoryMbOk) return "ok";
  return "bad";
}

export default function PerformanceMonitor() {
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "1";
  });
  const [fps, setFps] = useState(0);
  const [frameMs, setFrameMs] = useState(0);
  const [memoryMb, setMemoryMb] = useState<number | null>(null);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!visible) return;

    const tick = (now: number) => {
      frameCountRef.current += 1;
      const elapsed = now - lastTimeRef.current;

      if (elapsed >= 500) {
        setFps(Math.round((frameCountRef.current * 1000) / elapsed));
        setFrameMs(elapsed / frameCountRef.current);
        frameCountRef.current = 0;
        lastTimeRef.current = now;

        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        if (mem?.usedJSHeapSize) {
          setMemoryMb(Math.round(mem.usedJSHeapSize / 1024 / 1024));
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [visible]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setVisible((v) => {
          const next = !v;
          localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!visible) {
    return (
      <button
        type="button"
        className="perf-monitor-trigger"
        onClick={() => {
          setVisible(true);
          localStorage.setItem(STORAGE_KEY, "1");
        }}
        aria-label="Performans monitörünü aç (Ctrl+Shift+M)"
        title="Performans monitörü (Ctrl+Shift+M)"
      >
        perf
      </button>
    );
  }

  const fpsL = fpsLevel(fps);
  const frameL = frameMsLevel(frameMs);
  const memL = memoryMb != null ? memoryLevel(memoryMb) : null;

  return (
    <div
      className="perf-monitor"
      role="status"
      aria-label="Performans monitörü"
    >
      <div className="perf-monitor__row">
        <span className="perf-monitor__label">FPS</span>
        <span className={`perf-monitor__value perf-monitor__value--${fpsL}`} title="≥55 iyi, ≥30 orta, &lt;30 kötü">
          {fps}
        </span>
      </div>
      <div className="perf-monitor__row">
        <span className="perf-monitor__label">Frame</span>
        <span className={`perf-monitor__value perf-monitor__value--${frameL}`} title="≤18ms iyi, ≤33ms orta, &gt;33ms kötü">
          {frameMs.toFixed(1)} ms
        </span>
      </div>
      {memoryMb != null && (
        <div className="perf-monitor__row">
          <span className="perf-monitor__label">RAM</span>
          <span className={`perf-monitor__value perf-monitor__value--${memL}`} title="≤150MB iyi, ≤400MB orta, &gt;400MB kötü">
            {memoryMb} MB
          </span>
        </div>
      )}
      <p className="perf-monitor__hint">
        Yeşil: iyi · Sarı: orta · Kırmızı: kötü
      </p>
      <button
        type="button"
        className="perf-monitor__close"
        onClick={() => {
          setVisible(false);
          localStorage.setItem(STORAGE_KEY, "0");
        }}
        aria-label="Monitörü kapat"
      >
        ×
      </button>
    </div>
  );
}
