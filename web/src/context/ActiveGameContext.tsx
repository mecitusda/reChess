import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type ActiveGameContextValue = {
  inActiveGame: boolean;
  gameId: string | null;  
  setInActiveGame: (gameId: string | null) => void;
  opponentConnected: boolean;
  setOpponentConnected: (connected: boolean) => void;
};

const ActiveGameContext = createContext<ActiveGameContextValue | null>(null);

export function ActiveGameProvider({ children }: { children: ReactNode }) {
  const [gameId, setGameId] = useState<string | null>(null);
  const [opponentConnected, setOpponentConnectedState] = useState(true);

  const setInActiveGame = useCallback((id: string | null) => {
    setGameId(id);
    if (id == null) setOpponentConnectedState(true);
  }, []);

  const setOpponentConnected = useCallback((connected: boolean) => {
    setOpponentConnectedState(connected);
  }, []);

  const value: ActiveGameContextValue = {
    inActiveGame: gameId != null,
    gameId,
    setInActiveGame,
    opponentConnected: opponentConnected,
    setOpponentConnected,
  };

  return (
    <ActiveGameContext.Provider value={value}>
      {children}
    </ActiveGameContext.Provider>
  );
}

export function useActiveGame(): ActiveGameContextValue {
  const ctx = useContext(ActiveGameContext);
  if (!ctx) {
    return {
      inActiveGame: false,
      gameId: null,
      setInActiveGame: () => {},
      opponentConnected: true,
      setOpponentConnected: () => {},
    };
  }
  return ctx;
}
