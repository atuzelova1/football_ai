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
import { ClubBadge, ErrorState, Loading, Methodology } from "./components";
import { clubName } from "./format";
const OverviewPage = lazy(() => import("./pages/Overview"));
const MatchesPage = lazy(() => import("./pages/Matches"));
const OpponentsPage = lazy(() => import("./pages/Opponents"));
const PredictionPage = lazy(() => import("./pages/Prediction"));
const SimulatorPage = lazy(() => import("./pages/Simulator"));
const AdvisorPage = lazy(() => import("./pages/Advisor"));

const pages = [
  {
    path: "/overview",
    label: "Обзор команды",
    icon: ChartNoAxesCombined,
    caption: "Исследование сезона",
  },
  {
    path: "/matches",
    label: "Анализ матчей",
    icon: Goal,
    caption: "Матчевая лаборатория",
  },
  {
    path: "/opponents",
    label: "Анализ соперников",
    icon: Radar,
    caption: "Стили и противостояния",
  },
  {
    path: "/prediction",
    label: "ML-прогноз",
    icon: BrainCircuit,
    caption: "Проверка модели",
  },
  {
    path: "/simulator",
    label: "Симулятор",
    icon: SlidersHorizontal,
    caption: "Сравнение решений",
  },
  {
    path: "/advisor",
    label: "AI-советник",
    icon: Sparkles,
    caption: "От гипотезы к действию",
  },
];
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
          Рабочее пространство <span>01</span>
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
        <div className="sidebar-research">
          <div className="mini-icon">
            <FlaskConical size={21} />
          </div>
          <h3>
            Почему команда
            <br />
            теряет очки?
          </h3>
          <p>
            От статистики матчей —<br />к проверяемой тактике.
          </p>
          <button onClick={() => ctx.setMethodologyOpen(true)}>
            Как устроено исследование <ArrowUpRight size={15} />
          </button>
        </div>
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
              Лаборатория <span>/</span> <b>{current.label}</b>
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
                <Route path="/opponents" element={<OpponentsPage />} />
                <Route path="/prediction" element={<PredictionPage />} />
                <Route path="/simulator" element={<SimulatorPage />} />
                <Route path="/advisor" element={<AdvisorPage />} />
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
