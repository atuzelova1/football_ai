import { useEffect, useState } from "react";
import { SavedScenarios } from "../savedScenarios";
import {
  ArrowRight,
  Check,
  Crosshair,
  SlidersHorizontal,
  Sparkles,
  Target,
  Shield,
} from "lucide-react";
import { useApi } from "../api";
import { useApp } from "../context";
import type { Simulation, TacticalScenario } from "../types";
import {
  Action,
  Disclosure,
  Empty,
  ErrorState,
  Kpi,
  InfoHint,
  Loading,
  OpponentSelect,
  PageTitle,
  Panel,
  PlanningControls,
  ProbabilityBars,
  ResearchDetails,
} from "../components";
import { AMBER, BLUE, MINT, ComparisonChart, TrendChart } from "../charts";
import { clubName, date, metricName, n, pct, signed } from "../format";

export const defaults: TacticalScenario[] = [
  {
    id: "creation",
    title: "Создание моментов",
    shot_volume_change: 0.1,
    shot_quality_change: 0,
    attack_xg_change: 0,
    xga_reduction: 0,
  },
  {
    id: "quality",
    title: "Качество ударов",
    shot_volume_change: 0,
    shot_quality_change: 0.1,
    attack_xg_change: 0,
    xga_reduction: 0,
  },
  {
    id: "defense",
    title: "Снижение опасности",
    shot_volume_change: 0,
    shot_quality_change: 0,
    attack_xg_change: 0,
    xga_reduction: 0.1,
  },
  {
    id: "combined",
    title: "Комбинированное улучшение",
    shot_volume_change: 0,
    shot_quality_change: 0.05,
    attack_xg_change: 0,
    xga_reduction: 0.05,
  },
  {
    id: "custom",
    title: "Свой сценарий",
    shot_volume_change: 0,
    shot_quality_change: 0,
    attack_xg_change: 0.1,
    xga_reduction: 0.1,
  },
];
export default function SimulatorPage({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const ctx = useApp();
  const [comparison, setComparison] = useState<TacticalScenario | null>(null);
  const draft = ctx.currentTacticalScenario ?? defaults[1];
  const [scenario, setScenario] = useState<TacticalScenario>(draft);
  const setDraft = (next: TacticalScenario) =>
    ctx.update({ currentTacticalScenario: next });
  const [customMode, setCustomMode] = useState<"direct" | "shots">(
    draft.attack_xg_change ? "direct" : "shots",
  );
  useEffect(() => {
    if (draft.attack_xg_change) setCustomMode("direct");
    else if (draft.shot_volume_change || draft.shot_quality_change) setCustomMode("shots");
  }, [
    ctx.selectedClubId,
    ctx.selectedOpponentId,
    ctx.currentTacticalScenario?.id,
    ctx.currentTacticalScenario?.shot_volume_change,
    ctx.currentTacticalScenario?.shot_quality_change,
    ctx.currentTacticalScenario?.attack_xg_change,
    ctx.currentTacticalScenario?.xga_reduction,
  ]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setScenario(draft);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [JSON.stringify(draft)]);
  const alternatives = defaults
    .filter((s) => s.id !== "custom")
    .map((s) => (s.id === scenario.id ? scenario : s));
  if (scenario.id === "custom") alternatives.push(scenario);
  if (comparison) alternatives.push(comparison);
  const asOf = ctx.selectedHistoricalMatchContext?.date;
  useEffect(() => setComparison(null), [ctx.selectedClubId, ctx.selectedOpponentId, ctx.isHome, asOf]);
  const body = {
    team_id: ctx.selectedClubId,
    opponent_id: ctx.selectedOpponentId,
    is_home: ctx.isHome,
    priority: ctx.priority,
    max_interventions: ctx.maxInterventions,
    priority_strength: ctx.priorityStrength,
    ...(asOf ? { as_of: asOf } : {}),
    scenarios: alternatives,
  };
  const api = useApi<Simulation>(
    "/api/simulation",
    body,
    !!ctx.selectedOpponentId &&
      JSON.stringify(draft) === JSON.stringify(scenario),
    { retainKey: JSON.stringify([ctx.selectedClubId,ctx.selectedOpponentId,ctx.isHome,asOf,ctx.priority,ctx.maxInterventions,ctx.priorityStrength]) },
  );
  const result = api.data ?? api.previousData,
    selected = result?.scenarios.find((s) => s.id === draft.id);
  const updating = !!ctx.selectedOpponentId && (JSON.stringify(draft) !== JSON.stringify(scenario) || api.loading);
  const previous = !!result && !api.data;
  const setValue = (
    key: keyof Pick<
      TacticalScenario,
      | "shot_volume_change"
      | "shot_quality_change"
      | "attack_xg_change"
      | "xga_reduction"
    >,
    value: number,
  ) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
  };
  const choose = (s: TacticalScenario) => {
    setDraft(s);
    setCustomMode(s.attack_xg_change ? "direct" : "shots");
  };
  return (
    <>
      {!embedded && (
        <PageTitle
          eyebrow="05 / Симулятор · Уровень 3"
          title="Сначала проверить. Потом менять."
          description="Сравните тактические альтернативы на реальной исторической базе и выберите приоритет штаба."
        />
      )}
      {!embedded && (
        <div className="context-toolbar simulator-toolbar">
          <OpponentSelect />
          <PlanningControls />
        </div>
      )}
      {asOf && (
        <div className="context-help">
          <span>База до {date(asOf)} <InfoHint label="О предматчевой базе" text="Используются только матчи до выбранной даты. Полный сезон доступен отдельно как ретроспектива." /></span>
          <button
            className="inline-link"
            onClick={() =>
              ctx.update({
                selectedHistoricalMatchContext: null,
                selectedMatchId: null,
              })
            }
          >
            Перейти к ретроспективной базе полного сезона
          </button>
        </div>
      )}
      <div className="simulation-layout">
        <div className="scenario-editor">
          <Panel
            title="Тактическая гипотеза"
            subtitle="Выберите направление, затем задайте допущение"
          >
            <div className="scenario-options">
              {defaults.map((s, i) => {
                const Icon = [
                  Crosshair,
                  Target,
                  Shield,
                  SlidersHorizontal,
                  Sparkles,
                ][i];
                return (
                  <button
                    key={s.id}
                    className={draft.id === s.id ? "active" : ""}
                    onClick={() => choose(s)}
                  >
                    <Icon size={18} />
                    <span>{s.title}</span>
                    {draft.id === s.id && <Check size={15} />}
                  </button>
                );
              })}
            </div>
            <div className="slider-section">
              <div className="eyebrow">Пользовательские допущения</div>
              {draft.id === "custom" && (
                <label className="field">
                  Способ изменения атаки
                  <select
                    aria-label="Способ изменения атакующего xG"
                    value={customMode}
                    onChange={(e) => {
                      const mode = e.target.value as typeof customMode;
                      setCustomMode(mode);
                      const next = {
                        ...draft,
                        attack_xg_change: 0,
                        shot_volume_change: 0,
                        shot_quality_change: 0,
                      };
                      setDraft(next);
                    }}
                  >
                    <option value="direct">
                      Изменить атакующий xG напрямую
                    </option>
                    <option value="shots">Через объём и качество ударов</option>
                  </select>
                </label>
              )}
              {(draft.id === "creation" ||
                (draft.id === "custom" && customMode === "shots")) && (
                <Slider
                  label="Объём ударов"
                  value={draft.shot_volume_change}
                  onChange={(v) => setValue("shot_volume_change", v)}
                  help="Качество одного удара сохраняется."
                />
              )}
              {(draft.id === "quality" ||
                draft.id === "combined" ||
                (draft.id === "custom" && customMode === "shots")) && (
                <Slider
                  label="Среднее качество удара"
                  value={draft.shot_quality_change}
                  onChange={(v) => setValue("shot_quality_change", v)}
                  help="Относительное изменение xG одного удара."
                />
              )}
              {draft.id === "custom" && customMode === "direct" && (
                <Slider
                  label="Атакующий xG"
                  value={draft.attack_xg_change}
                  onChange={(v) => setValue("attack_xg_change", v)}
                  help="Прямой множитель без повторного учёта ударов."
                />
              )}
              {(draft.id === "defense" ||
                draft.id === "combined" ||
                draft.id === "custom") && (
                <Slider
                  label="Снижение xGA"
                  value={draft.xga_reduction}
                  onChange={(v) => setValue("xga_reduction", v)}
                  help="Положительное значение снижает опасность атак соперника."
                />
              )}
            </div>
          </Panel>
        </div>
        <div className="scenario-output" aria-busy={updating}>
          {api.error && <ErrorState compact error={api.error} retry={api.retry} />}
          {updating && <Loading compact label="Пересчитываем сценарий…" />}
          {previous && <p className="calculation-note">{api.error ? "Показан предыдущий расчёт. Новые параметры не применены." : "Показан предыдущий расчёт до завершения обновления."}</p>}
          {!result || !selected ? (
            api.data ? <ErrorState compact error="Сервер не вернул выбранный сценарий." retry={api.retry} /> : !updating && !api.error ? <p className="calculation-note">Выберите соперника и сценарий для расчёта.</p> : null
          ) : (
            <>
              <Panel
                className="light-surface scenario-result"
                title="Что меняется в модели"
                subtitle={`${clubName(ctx.club!.name)} — ${clubName(ctx.opponent!.name)} · ${ctx.isHome ? "дома" : "в гостях"}`}
                action={<span className="compact-context"><span className="pill pill-mint">Расчёт Пуассона</span><InfoHint label="Как понимать модельный эффект" text="Ожидаемые очки и вероятности рассчитаны при заданных допущениях. Это модельный результат, а не гарантированный эффект тактической инструкции." /></span>}
              >
                <div className="baseline-vs" data-team-id={result.team_id}>
                  <div>
                    <small>Историческая база</small>
                    <strong>
                      {n(result.baseline.probabilities.expected_points, 2)}{" "}
                      <span>очк.</span>
                    </strong>
                    <span>
                      xG {n(result.baseline.attack_xg, 2)} · xGA{" "}
                      {n(result.baseline.defense_xg, 2)}
                    </span>
                  </div>
                  <ArrowRight size={23} />
                  <div>
                    <small>{selected.title}</small>
                    <strong className="text-blue">
                      {n(selected.probabilities.expected_points, 2)}{" "}
                      <span>очк.</span>
                    </strong>
                    <span>
                      xG {n(selected.attack_xg, 2)} · xGA{" "}
                      {n(selected.defense_xg, 2)}
                    </span>
                  </div>
                </div>
                <div
                  className={`scenario-gain ${selected.delta_expected_points < 0 ? "negative" : ""}`}
                >
                  <span>Изменение ожидаемых очков</span>
                  <b data-testid="scenario-gain">
                    {signed(selected.delta_expected_points, 3)}
                  </b>
                  <small>за один модельный матч</small>
                </div>
                <p className="scenario-assumptions">
                  Допущение:{" "}
                  {Object.entries(selected.assumptions)
                    .filter(([, v]) => v !== 0)
                    .map(([k, v]) => `${metricName[k]} ${signed(v * 100, 0)}%`)
                    .join(" · ") || "Без изменений"}
                </p>
                <ProbabilityBars value={selected.probabilities} />
                <details className="baseline-details">
                  <summary>Вероятности базового сценария</summary>
                  <ProbabilityBars
                    value={result.baseline.probabilities}
                    compact
                  />
                </details>
              </Panel>
              <ResearchDetails title="Чувствительность к допущению">
                <Panel
                  title="Ожидаемые очки при разных допущениях"
                  subtitle="Половина, исходный размер и полуторное изменение"
                >
                  <ComparisonChart
                    height={205}
                    data={selected.sensitivity.map((s) => ({
                      label: `×${n(s.assumption_factor, 1)}`,
                      points: s.expected_points,
                    }))}
                    bars={[
                      { key: "points", name: "Ожидаемые очки", color: BLUE },
                    ]}
                    reference={result.baseline.probabilities.expected_points}
                  />
                  <p className="chart-note">
                    {selected.uncertainty} При достижении предела изменение
                    ограничено ±50%.
                  </p>
                </Panel>
              </ResearchDetails>
            </>
          )}
        </div>
      </div>
      <SavedScenarios scenario={draft} onCompare={setComparison} />
      {result && (
        <>
          <Panel
            title="Альтернативы для тренерского штаба"
            subtitle="Прирост, затраты внимания и приоритет — в одном сравнении"
          >
            <div className="scenario-comparison-grid">
              {result.scenarios.map((s) => (
                <button
                  key={s.id}
                  className={`scenario-compare-card ${s.id === draft.id ? "selected" : ""} ${!s.eligible ? "ineligible" : ""}`}
                  onClick={() =>
                    choose(
                      s.id === "saved"
                        ? {
                            ...alternatives.find((a) => a.id === s.id)!,
                            id: "custom",
                            title: "Свой сценарий",
                          }
                        : alternatives.find((a) => a.id === s.id)!,
                    )
                  }
                >
                  <span className="eyebrow">
                    {s.id === draft.id
                      ? "Выбранный сценарий"
                      : `${s.interventions} направл. работы`}
                  </span>
                  <h3>{s.title}</h3>
                  <strong>
                    {signed(s.delta_expected_points, 3)} <small>очк.</small>
                  </strong>
                  <span>
                    Ожидаемые очки: {n(s.probabilities.expected_points, 2)}
                  </span>
                  <span>Победа: {pct(s.probabilities.win)}</span>
                  <div className="scenario-card-footer">
                    <span>
                      {s.eligible ? "В пределах ресурса" : "Превышает ресурс"}
                    </span>
                    <Check size={14} />
                  </div>
                </button>
              ))}
            </div>
          </Panel>
          <ResearchDetails title="Как рассчитано: сравнение и формулы">
            <Panel
              title="База против тактических альтернатив"
              subtitle="Ожидаемые очки за модельный матч"
            >
              <ComparisonChart
                horizontal
                height={280}
                data={[
                  {
                    label: "База",
                    points: result.baseline.probabilities.expected_points,
                  },
                  ...result.scenarios.map((s) => ({
                    label: s.title,
                    points: s.probabilities.expected_points,
                  })),
                ]}
                bars={[{ key: "points", name: "Ожидаемые очки", color: BLUE }]}
              />
            </Panel>
            <Disclosure title="Наблюдаемая база, формула и неопределённость">
              <p>{result.baseline.method}</p>
              <p>
                Матчей клуба: {result.baseline.sample_size}; соперника:{" "}
                {result.baseline.opponent_sample_size}. {result.baseline.mode}.
              </p>
              <p>
                95% интервал среднего базового xG: [
                {n(result.baseline.confidence_intervals.attack_xg[0], 2)};{" "}
                {n(result.baseline.confidence_intervals.attack_xg[1], 2)}].
              </p>
              <p>
                95% интервал базовых ожидаемых очков: [
                {n(result.baseline.confidence_intervals.expected_points[0], 2)};{" "}
                {n(result.baseline.confidence_intervals.expected_points[1], 2)}
                ].
              </p>
              <p>{result.baseline.uncertainty}</p>
              <p>
                Атакующий xG = исходный xG × (1 + изменение объёма) × (1 +
                изменение качества), либо один прямой множитель xG. Эти режимы
                взаимоисключающие. Ожидаемые очки = 3P(победа) + P(ничья).
              </p>
              {result.limitations.map((t) => (
                <p key={t}>{t}</p>
              ))}
            </Disclosure>
          </ResearchDetails>
          <div className="next-step horizontal">
            <div>
              <div className="eyebrow">Следующий шаг / AI-советник</div>
              <h2>Выбрать эксперимент для штаба</h2>
              <p>
                Советник получит выбранные команды, ресурс, приоритет и точные
                значения текущего сценария.
              </p>
            </div>
            <Action
              disabled={updating || !!api.error || !api.data || !selected?.eligible}
              onClick={() =>
                ctx.go("/advisor", { currentTacticalScenario: scenario })
              }
            >
              Перейти к рекомендации
            </Action>
          </div>
        </>
      )}
    </>
  );
}
function Slider({
  label,
  value,
  onChange,
  help,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  help: string;
}) {
  return (
    <label className="scenario-slider">
      <div>
        <span>{label}</span>
        <b>{signed(value * 100, 0)}%</b>
      </div>
      <input
        type="range"
        aria-label={label}
        min="-50"
        max="50"
        step="1"
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <div className="range-endpoints">
        <small>−50%</small>
        <small>0%</small>
        <small>+50%</small>
      </div>
      <p>{help}</p>
    </label>
  );
}
