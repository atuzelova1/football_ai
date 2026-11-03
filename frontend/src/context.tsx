import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useApi } from "./api";
import type {
  Club,
  Evidence,
  HistoricalContext,
  Meta,
  Priority,
  TacticalScenario,
  TeamMatch,
} from "./types";

interface Selection {
  selectedClubId: number | null;
  selectedOpponentId: number | null;
  selectedMatchId: number | null;
  selectedHistoricalMatchContext: HistoricalContext | null;
  currentTacticalScenario: TacticalScenario | null;
  selectedResearchEvidence: Evidence | null;
  isHome: boolean;
  priority: Priority;
  maxInterventions: number;
  priorityStrength: number;
}
const empty: Selection = {
  selectedClubId: null,
  selectedOpponentId: null,
  selectedMatchId: null,
  selectedHistoricalMatchContext: null,
  currentTacticalScenario: null,
  selectedResearchEvidence: null,
  isHome: true,
  priority: "balanced",
  maxInterventions: 2,
  priorityStrength: 0.15,
};
const positive = (v: string | null) =>
  v && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
function initial(): Selection {
  let saved: Partial<Selection> = {};
  try {
    saved = JSON.parse(localStorage.getItem("football-ai:selection") ?? "{}");
  } catch {
    /* Повреждённое локальное состояние сбрасывается. */
  }
  const q = new URLSearchParams(window.location.search);
  const savedState = { ...empty, ...saved };
  if (q.has("club")) {
    const club = positive(q.get("club")),
      opponent = positive(q.get("opponent")),
      match = positive(q.get("match"));
    const same =
      club === savedState.selectedClubId &&
      opponent === savedState.selectedOpponentId;
    const h = savedState.selectedHistoricalMatchContext;
    return {
      ...savedState,
      selectedClubId: club,
      selectedOpponentId: opponent,
      selectedMatchId: match,
      selectedHistoricalMatchContext: same && h?.matchId === match ? h : null,
      currentTacticalScenario: same ? savedState.currentTacticalScenario : null,
      selectedResearchEvidence:
        same && savedState.selectedResearchEvidence?.id === q.get("evidence")
          ? savedState.selectedResearchEvidence
          : null,
    };
  }
  return savedState;
}
interface AppContext extends Selection {
  clubs: Club[];
  club: Club | null;
  opponent: Club | null;
  meta: Meta | undefined;
  matches: TeamMatch[] | undefined;
  bootLoading: boolean;
  bootError: string | undefined;
  retryBoot: () => void;
  matchesError: string | undefined;
  retryMatches: () => void;
  update: (patch: Partial<Selection>) => void;
  setClub: (id: number) => void;
  setOpponent: (id: number) => void;
  go: (path: string, patch?: Partial<Selection>) => void;
  openMatch: (match: TeamMatch) => void;
  showEvidence: (evidence: Evidence) => void;
  methodologyOpen: boolean;
  setMethodologyOpen: (open: boolean) => void;
}
const Context = createContext<AppContext | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Selection>(initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const clubsApi = useApi<Club[]>("/api/clubs");
  const metaApi = useApi<Meta>("/api/meta");
  const clubs = clubsApi.data ?? [];
  const matchesApi = useApi<TeamMatch[]>(
    `/api/clubs/${state.selectedClubId}/matches`,
    undefined,
    !!state.selectedClubId && clubs.length > 0,
  );
  const url = (path: string, s: Selection) => {
    const q = new URLSearchParams();
    if (s.selectedClubId) q.set("club", String(s.selectedClubId));
    if (s.selectedOpponentId) q.set("opponent", String(s.selectedOpponentId));
    if (s.selectedMatchId) q.set("match", String(s.selectedMatchId));
    if (s.selectedResearchEvidence)
      q.set("evidence", s.selectedResearchEvidence.id);
    return path + "?" + q.toString();
  };
  const apply = (path: string, patch: Partial<Selection>, replace = false) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
    navigate(url(path, next), { replace });
  };
  const update = (patch: Partial<Selection>) =>
    apply(location.pathname, patch, true);
  const setClub = (id: number) =>
    apply(location.pathname, {
      ...empty,
      selectedClubId: id,
      selectedOpponentId: clubs.find((c) => c.team_id !== id)?.team_id ?? null,
    });
  const setOpponent = (id: number) =>
    update({
      selectedOpponentId: id,
      selectedMatchId: null,
      selectedHistoricalMatchContext: null,
      currentTacticalScenario: null,
      selectedResearchEvidence: null,
    });
  useEffect(() => {
    if (!clubs.length) return;
    if (!clubs.some((c) => c.team_id === state.selectedClubId)) {
      const id = clubs[0].team_id;
      const next = {
        ...empty,
        selectedClubId: id,
        selectedOpponentId: clubs[1]?.team_id ?? null,
      };
      setState(next);
      navigate(url(location.pathname, next), { replace: true });
    } else if (
      !clubs.some((c) => c.team_id === state.selectedOpponentId) ||
      state.selectedClubId === state.selectedOpponentId
    ) {
      const next = {
        ...state,
        selectedOpponentId:
          clubs.find((c) => c.team_id !== state.selectedClubId)?.team_id ??
          null,
      };
      setState(next);
      navigate(url(location.pathname, next), { replace: true });
    }
  }, [clubsApi.data, state.selectedClubId, state.selectedOpponentId]);
  useEffect(() => {
    try {
      localStorage.setItem("football-ai:selection", JSON.stringify(state));
    } catch {
      /* Приватный режим не мешает работе. */
    }
  }, [state]);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const id = positive(q.get("club"));
    if (!id) return;
    const opponent = positive(q.get("opponent"));
    const match = positive(q.get("match"));
    setState((s) => {
      if (
        s.selectedClubId === id &&
        s.selectedOpponentId === opponent &&
        s.selectedMatchId === match
      )
        return s;
      return {
        ...(s.selectedClubId === id ? s : empty),
        selectedClubId: id,
        selectedOpponentId: opponent,
        selectedMatchId: match,
        selectedHistoricalMatchContext: null,
        currentTacticalScenario:
          s.selectedClubId === id && s.selectedOpponentId === opponent
            ? s.currentTacticalScenario
            : null,
        selectedResearchEvidence: null,
      };
    });
  }, [location.search]);
  useEffect(() => {
    if (matchesApi.data && state.selectedMatchId) {
      const selected = matchesApi.data.find(
        (m) => m.match_id === state.selectedMatchId,
      );
      if (!selected || selected.opponent_id !== state.selectedOpponentId)
        update({
          selectedMatchId: null,
          selectedHistoricalMatchContext: null,
          selectedResearchEvidence: null,
        });
    }
  }, [matchesApi.data, state.selectedMatchId, state.selectedOpponentId]);
  const club = clubs.find((c) => c.team_id === state.selectedClubId) ?? null;
  const opponent =
    clubs.find((c) => c.team_id === state.selectedOpponentId) ?? null;
  const value: AppContext = {
    ...state,
    clubs,
    club,
    opponent,
    meta: metaApi.data,
    matches: matchesApi.data,
    bootLoading: clubsApi.loading || metaApi.loading,
    bootError: clubsApi.error ?? metaApi.error,
    retryBoot: () => {
      clubsApi.retry();
      metaApi.retry();
    },
    matchesError: matchesApi.error,
    retryMatches: matchesApi.retry,
    update,
    setClub,
    setOpponent,
    go: (path, patch = {}) => apply(path, patch),
    openMatch: (match) =>
      apply("/matches", {
        selectedMatchId: match.match_id,
        selectedOpponentId: match.opponent_id,
        isHome: !!match.is_home,
        selectedHistoricalMatchContext: null,
        currentTacticalScenario: null,
      }),
    showEvidence: (evidence) =>
      apply("/overview", { selectedResearchEvidence: evidence }),
    methodologyOpen,
    setMethodologyOpen,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useApp() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Контекст приложения недоступен");
  return ctx;
}
