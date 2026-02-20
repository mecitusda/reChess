import styles from "./MatchHistoryItem.module.css";
import type { MatchResult } from "./types";
import { mapReason } from "./reason";

type Props = {
  match: MatchResult;
  onClick?: (id: string) => void;
};

export function MatchHistoryItem({ match, onClick }: Props) {
  const created = new Date(match.createdAt);
  const createdLabel = Number.isNaN(created.getTime())
    ? String(match.createdAt || "")
    : created.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });

  return (
    <button
      type="button"
      className={`${styles.item} ${match.result === "win" ? styles.win : match.result === "loss" ? styles.loss : styles.draw}`}
      onClick={() => onClick?.(match.id)}
    >
      <span>
        <div className={styles.topLine}>{match.opponent}</div>
        <div className={styles.midLine}>
          {match.score} · {match.timeControl}
        </div>
        <div className={styles.bottomLine}>
          {mapReason(match.reason)} · {createdLabel}
        </div>
      </span>
    </button>
  );
}

