import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  BrainCircuit,
  ChartNoAxesCombined,
  ChevronDown,
  Database,
  FlaskConical,
  Goal,
  Menu,
  Radar,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useApp } from "./context";
import {
  ClubBadge,
  ErrorState,
  Loading,
  Methodology,
  Panel,
  Disclosure,
  Note,
  OpponentSelect,
  PlanningControls,
} from "./components";
import { CoachingBriefButton } from "./coach";
import { useApi } from "./api";
import type { Overview, Recommendation } from "./types";
import type { ReactNode } from "react";
import { clubName } from "./format";
const OverviewPage = lazy(() => import("./pages/Overview"));
const MatchesPage = lazy(() => import("./pages/Matches"));
const OpponentsPage = lazy(() => import("./pages/Opponents"));
const PredictionPage = lazy(() => import("./pages/Prediction"));
const SimulatorPage = lazy(() => import("./pages/Simulator"));
const AdvisorPage = lazy(() => import("./pages/Advisor"));

const pages = [
  { path: "/overview", label: "Панель тренера", icon: ChartNoAxesCombined },
  { path: "/matches", label: "Разбор матчей", icon: Goal },
  { path: "/opponents", label: "Подготовка к сопернику", icon: Radar },
  { path: "/plan", label: "Тактический план", icon: SlidersHorizontal },
];
function ContextSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const location = useLocation();
  const [open, setOpen] = useState(location.hash === `#${id}`);
  useEffect(() => {
    if (location.hash === `#${id}`) setOpen(true);
  }, [location.hash, id]);
  useEffect(() => {
    if (open && location.hash === `#${id}`)
      document
        .getElementById(id)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [open, location.hash, id]);
  return (
    <details
      id={id}
      className="context-section"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {title}
        <span>{open ? "Свернуть" : "Открыть"}</span>
      </summary>
      {open && <div className="context-section-body">{children}</div>}
    </details>
  );
}
function PreparationPage() {
  return (
    <>
      <OpponentsPage />
      <ContextSection id="prediction" title="Историческая оценка исхода">
        <PredictionPage embedded />
      </ContextSection>
    </>
  );
}
function PlanPage() {
  const ctx = useApp();
  const overview = useApi<Overview>(
    `/api/clubs/${ctx.selectedClubId}/overview`,
  );
  const diagnosis = overview.data?.coaching;
  const historical = ctx.selectedHistoricalMatchContext;
  const [chosen, setChosen] = useState<Pick<
    Recommendation,
    "id" | "title"
  > | null>(null);
  const choiceContext = JSON.stringify([
    ctx.selectedClubId,
    ctx.selectedOpponentId,
    ctx.selectedMatchId,
    ctx.isHome,
    historical,
    ctx.currentTacticalScenario,
    ctx.priority,
    ctx.maxInterventions,
    ctx.priorityStrength,
  ]);
  useEffect(() => setChosen(null), [choiceContext]);
  const location = useLocation();
  useEffect(() => {
    if (location.hash === "#scenarios")
      document
        .getElementById("scenarios")
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [location.hash]);
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">От наблюдения к эксперименту</div>
          <h1>Тактический план</h1>
          <p>
            Сравните допущения, выберите одно направление работы и подготовьте
            план проверки.
          </p>
        </div>
      </div>
      <div className="context-toolbar">
        <OpponentSelect />
        <PlanningControls />
      </div>
      <Panel title="1. Уточнить тренерскую задачу" className="plan-problem">
        {historical ? (
          <>
            <p>
              Матчи до <b>{historical.date}</b>.
            </p>
            <Disclosure title="Сравнить с итогами сезона 2015/16">
              <h3>{diagnosis?.title}</h3>
              <p>{diagnosis?.text}</p>
            </Disclosure>
          </>
        ) : diagnosis ? (
          <>
            <h3>{diagnosis.title}</h3>
            <p>{diagnosis.text}</p>
          </>
        ) : overview.error ? (
          <ErrorState compact error={overview.error} retry={overview.retry} />
        ) : (
          <Loading compact label="Загружаем задачу команды…" />
        )}
      </Panel>
      <section id="scenarios" className="plan-stage">
        <div className="section-intro">
          <h2>2. Сравнить тактические альтернативы</h2>
          <p>
            Выберите сценарий и сравните его с базой.
          </p>
        </div>
        <SimulatorPage embedded />
      </section>
      <ContextSection
        id="recommendation"
        title="3. Получить рекомендацию и выбрать эксперимент"
      >
        <AdvisorPage embedded onChoose={setChosen} chosenId={chosen?.id} />
      </ContextSection>
      <Panel title="4. Подготовить тренерскую сводку" className="brief-action">
        <p>
          Проблема, реальные основания, эксперимент, допущения, риски и план
          наблюдения — в одном документе для штаба.
        </p>
        {chosen && (
          <p className="chosen-plan" role="status">
            Для сводки выбрано: <b>{chosen.title}</b>
          </p>
        )}
        <CoachingBriefButton recommendationId={chosen?.id} />
      </Panel>
    </>
  );
}
function Brand() {
  return (
    <div className="brand">
      <img src="/favicon.svg" alt="" />
      <div>
        <strong>
          Football <span>AI</span>
        </strong>
        <small>Тактический интеллект</small>
      </div>
    </div>
  );
}
export default function App() {
  const ctx = useApp();
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  const current = pages.find((p) => p.path === location.pathname) ?? pages[0];
  useEffect(() => {
    window.scrollTo({ top: 0 });
    setMenu(false);
  }, [location.pathname]);
  return (
    <div className="app-shell">
      {menu && (
        <button
          className="sidebar-scrim"
          aria-label="Закрыть меню"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            onClick={() => setMenu(false)}
            aria-label="Закрыть навигацию"
          >
            <X size={19} />
          </button>
        </div>
        <div className="workspace-label">
          Рабочее пространство <span>Тренер</span>
        </div>
        <nav aria-label="Основная навигация">
          {pages.map((p, i) => (
            <button
              key={p.path}
              onClick={() => ctx.go(p.path)}
              className={`nav-item ${current.path === p.path ? "active" : ""}`}
              aria-current={current.path === p.path ? "page" : undefined}
            >
              <p.icon size={19} />
              <span>{p.label}</span>
              <small>0{i + 1}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="method-button"
            onClick={() => ctx.setMethodologyOpen(true)}
          >
            <Database size={16} />
            <span>Методология и данные</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="source-line">
            <span className="status-dot" />
            StatsBomb Open Data
          </div>
          <p>Ла Лига · сезон 2015/16</p>
          <a
            href="https://github.com/hudl/open-data"
            target="_blank"
            rel="noreferrer"
          >
            Источник данных ↗
          </a>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-only"
              aria-label="Открыть меню"
              onClick={() => setMenu(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              Штаб <span>/</span> <b>{current.label}</b>
            </span>
          </div>
          <div className="topbar-right">
            <span className="season-pill">
              <Activity size={13} />
              Исторический сезон <b>2015/16</b>
            </span>
            <label className="club-selector">
              <ClubBadge name={ctx.club?.name ?? "Клуб"} />
              <div>
                <small>Выбранный клуб</small>
                <select
                  aria-label="Выберите клуб"
                  value={ctx.selectedClubId ?? ""}
                  onChange={(e) => ctx.setClub(Number(e.target.value))}
                  disabled={!ctx.clubs.length}
                >
                  {!ctx.club && <option value="">Загрузка клубов…</option>}
                  {ctx.clubs.map((c) => (
                    <option value={c.team_id} key={c.team_id}>
                      {clubName(c.name)}
                    </option>
                  ))}
                </select>
              </div>
              <ChevronDown size={16} />
            </label>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {ctx.bootError ? (
            <ErrorState error={ctx.bootError} retry={ctx.retryBoot} />
          ) : ctx.bootLoading || !ctx.club ? (
            <Loading />
          ) : (
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/overview" element={<OverviewPage />} />
                <Route path="/matches" element={<MatchesPage />} />
                <Route path="/opponents" element={<PreparationPage />} />
                <Route
                  path="/prediction"
                  element={
                    <Navigate
                      to={"/opponents" + location.search + "#prediction"}
                      replace
                    />
                  }
                />
                <Route
                  path="/simulator"
                  element={
                    <Navigate
                      to={"/plan" + location.search + "#scenarios"}
                      replace
                    />
                  }
                />
                <Route
                  path="/advisor"
                  element={
                    <Navigate
                      to={"/plan" + location.search + "#recommendation"}
                      replace
                    />
                  }
                />
                <Route path="/plan" element={<PlanPage />} />
                <Route
                  path="*"
                  element={
                    <Navigate to={"/overview" + location.search} replace />
                  }
                />
              </Routes>
            </Suspense>
          )}
        </main>
        <footer className="app-footer">
          <span className="footer-source">
            <a
              href="https://github.com/hudl/open-data"
              target="_blank"
              rel="noreferrer"
            >
              <img
                src="/statsbomb.png"
                alt="StatsBomb — источник данных"
                className="statsbomb-logo"
              />
            </a>
            Football AI · Тактический интеллект
          </span>
          <span>
            Данные и xG:{" "}
            <a
              href="https://github.com/hudl/open-data"
              target="_blank"
              rel="noreferrer"
            >
              StatsBomb
            </a>{" "}
            · Историческая аналитика, не текущий прогноз
          </span>
        </footer>
      </div>
      {ctx.methodologyOpen && <Methodology />}
    </div>
  );
}
