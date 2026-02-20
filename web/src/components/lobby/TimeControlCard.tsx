import type{ TimeControl } from "../../types/time";

export default function TimeControlCard({
  timeControl,
  onClick,
  isSearching,
}: {
  timeControl: TimeControl;
  onClick: () => void;
  isSearching?: boolean;
}) {
  const speedLabel =
    timeControl.speed === "bullet"
      ? "Bullet"
      : timeControl.speed === "blitz"
        ? "Yıldırım"
        : timeControl.speed === "rapid"
          ? "Hızlı"
          : timeControl.speed === "classical"
            ? "Klasik"
            : "";

  const isCustom = timeControl.speed === "custom" || timeControl.id === "custom";

  return (
    <button
      className={`time-card ${timeControl.speed} ${isSearching ? "isSearching" : ""}`}
      onClick={onClick}
      aria-busy={isSearching || undefined}
    >
      <div className="time">
        {isCustom ? "Özel" : `${timeControl.initial}+${timeControl.increment}`}
      </div>
      {!isCustom && <div className="speed">{speedLabel}</div>}
      {!isCustom && isSearching && (
        <div className="tcState" aria-label="Oyun aranıyor">
          <span className="tcState__icon" aria-hidden="true">♞</span>
          <span className="tcState__text">Oyun aranıyor</span>
        </div>
      )}
    </button>
  );
}
