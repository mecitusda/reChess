import type { TimeControl } from "../../types/time";
import TimeControlCard from "./TimeControlCard";

interface Props {
  timeControls: TimeControl[];
  onSelect: (tc: TimeControl) => void;
  searchingKey?: string | null;
}

export default function TimeControlGrid({ timeControls, onSelect, searchingKey }: Props) {
  return (
    <div className="time-grid">
      {timeControls.map(tc => (
        <TimeControlCard
          key={tc.id}
          timeControl={tc}
          onClick={() => onSelect(tc)}
          isSearching={
            !!searchingKey &&
            tc.speed !== "custom" &&
            tc.id !== "custom" &&
            `${tc.initial}+${tc.increment}` === searchingKey
          }
        />
      ))}
    </div>
  );
}
