import {
  createContext,
  useContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from "react";

import type { SokoSessionContext } from "@soko/shared-types";

import type { ShellView, SokoMode } from "../app-shell";
import type { ActiveBusiness, AgentSettings, SessionResponse } from "../soko-application-shared";

export interface OwnerCoreState {
  session: SessionResponse | null;
  setSession: Dispatch<SetStateAction<SessionResponse | null>>;
  sokoSessionContext: SokoSessionContext | null;
  setSokoSessionContext: Dispatch<SetStateAction<SokoSessionContext | null>>;
  business: ActiveBusiness | null;
  setBusiness: Dispatch<SetStateAction<ActiveBusiness | null>>;
  agentSettings: AgentSettings;
  setAgentSettings: Dispatch<SetStateAction<AgentSettings>>;
  view: ShellView;
  setView: Dispatch<SetStateAction<ShellView>>;
  mode: SokoMode;
  setMode: Dispatch<SetStateAction<SokoMode>>;
}

const OwnerCoreContext = createContext<OwnerCoreState | null>(null);

export function OwnerCoreProvider({
  value,
  children
}: {
  value: OwnerCoreState;
  children: ReactNode;
}) {
  return <OwnerCoreContext.Provider value={value}>{children}</OwnerCoreContext.Provider>;
}

export function useOwnerCore(): OwnerCoreState {
  const context = useContext(OwnerCoreContext);
  if (context === null) {
    throw new Error("useOwnerCore must be used within an OwnerCoreProvider");
  }
  return context;
}
