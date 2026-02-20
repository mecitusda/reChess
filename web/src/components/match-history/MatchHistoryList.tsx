import type { MatchResult } from "./types";
import { MatchHistoryItem } from "./MatchHistoryItem";

type Props = {
  matches: MatchResult[];
  onOpenMatch?: (id: string) => void;
};

export function MatchHistoryList({ matches, onOpenMatch }: Props) {
  if (!matches.length) {
    return <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 13, padding: "1.5rem 1rem" }}>No games played yet</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column"}}>
      {matches.map((m) => (
        <MatchHistoryItem key={m.id} match={m} onClick={onOpenMatch} />
      ))}
    </div>
  );
}

