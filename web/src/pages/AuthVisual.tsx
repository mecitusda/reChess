import { useEffect, useMemo, useRef, useState } from "react";
import ArrowRightAltIcon from '@mui/icons-material/ArrowRightAlt';
type Slide = {
  id: string;
  bg: string; 
  captionLines: string[];
};

const SLIDES: Slide[] = [
  {
    id: "dunes",
    bg: `url("/auth/1.jpg")`,
    captionLines: ["Stratejiyle öne çık.", "Doğru hamleyi yap, oyunu kontrol et."],
  },
  {
    id: "night",
    bg: `url("/auth/2.jpg")`,
    captionLines: ["Her hamle kayda değer.", "Oyunlarını sakla, geçmişini analiz et."],
  },
  {
    id: "glow",
    bg: `url("/auth/3.jpg")`,
    captionLines: ["Modern, sade bir deneyim.", "Hızlı başla, akıcı oyna."],
  }
];

export default function AuthVisual({
  onBack,
}: {
  onBack: () => void;
}) {
  const slides = useMemo(() => SLIDES, []);
  const [idx, setIdx] = useState(0);
  const timerRef = useRef<number | null>(null);
  const AUTOPLAY_MS = 6500;
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reduce = !!mq?.matches;
    if (reduce || slides.length <= 1) return;
    if (paused) return;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setIdx((v) => (v + 1) % slides.length);
    }, AUTOPLAY_MS);

    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [idx, slides.length, paused]);

  useEffect(() => {
    const onVis = () => setPaused(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const slide = slides[Math.min(idx, slides.length - 1)]!;

  return (
    <div className="authVisual">
      <div
        className="authVisual__image"
        style={{ backgroundImage: slide.bg }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="authVisual__top">
          
          <button className="authBack" type="button" onClick={onBack}>
            Lobiye dön <ArrowRightAltIcon sx={{ fontSize: 22}} />
          </button>
        </div>

        <div className="authVisual__caption">
          {slide.captionLines.map((t) => (
            <div key={t} className="authVisual__capLine">
              {t}
            </div>
          ))}
        </div>

        <div className="authVisual__dots" role="tablist" aria-label="Tanıtım slaytları">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`authDotBtn ${i === idx ? "isActive" : ""}`}
              aria-label={`${i + 1}. slayt`}
              aria-selected={i === idx}
              role="tab"
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
              onClick={() => setIdx(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

