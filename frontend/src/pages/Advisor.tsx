import { AIWorkspace, CoachingBriefButton } from "../coach";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FlaskConical,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useApi } from "../api";
import { useEffect, useState } from "react";
import { useApp } from "../context";
import type { Advisor, Recommendation, TacticalScenario } from "../types";
import {
  Action,
  Disclosure,
  ErrorState,
  EvidenceCard,
  InfoHint,
  Loading,
  OpponentSelect,
  PageTitle,
  Panel,
  PlanningControls,
  ResearchDetails,
} from "../components";
import { BLUE, ComparisonChart } from "../charts";
import { clubName, metricName, n, pct, signed } from "../format";

export default function AdvisorPage({
  embedded = false,
  onChoose,
  chosenId,
}: {
  embedded?: boolean;
  onChoose?: (choice: Pick<Recommendation, "id" | "title">) => void;
  chosenId?: string;
} = {}) {
  const ctx = useApp();
  const body = {
    team_id: ctx.selectedClubId, opponent_id: ctx.selectedOpponentId, is_home: ctx.isHome,
    priority: ctx.priority, max_interventions: ctx.maxInterventions, priority_strength: ctx.priorityStrength,
    ...(ctx.currentTacticalScenario ? { scenario: ctx.currentTacticalScenario } : {}),
    ...(ctx.selectedHistoricalMatchContext ? { as_of: ctx.selectedHistoricalMatchContext.date } : {}),
  };
  const bodyKey = JSON.stringify(body);
  const [requestBody, setRequestBody] = useState(body);
  useEffect(() => { const timer = window.setTimeout(() => setRequestBody(body), 300); return () => window.clearTimeout(timer); }, [bodyKey]);
  const api = useApi<Advisor>(
    "/api/advisor",
    requestBody,
    !!ctx.selectedOpponentId && bodyKey === JSON.stringify(requestBody),
  );
  const out = api.data;
  const primary =
    out?.recommendations.find((r) => r.selected_for_testing) ??
    out?.recommendations[0];
  return (
    <>
      {!embedded && (
        <PageTitle
          eyebrow="06 / AI-советник · Решение"
          title="Основание для следующего шага"
          description="Какое изменение проверить тренеру, почему и на основании каких матчей?"
        />
      )}
      {!embedded && (
        <div className="context-toolbar simulator-toolbar">
          <OpponentSelect />
          <PlanningControls />
        </div>
      )}
      {api.error ? (
        <ErrorState compact error={api.error} retry={api.retry} />
      ) : !out ? (
        <Loading compact label="Обновляем рекомендации…" />
      ) : (
        <>
          {!embedded && (
            <div className="advisor-intro" data-team-id={out.team.team_id}>
              <div className="advisor-icon">
                <Sparkles size={29} />
              </div>
              <div>
                <div className="eyebrow">
                  Рекомендации для тренерского штаба
                </div>
                <h2>
                  {clubName(out.team.name)} <span>против</span>{" "}
                  {out.opponent
                    ? clubName(out.opponent.name)
                    : "среднего соперника"}
                </h2>
                <p>
                  Показатели → проверяемая гипотеза → модельный эффект → план
                  оценки.
                </p>
              </div>
              <span className="pill pill-blue">
                <ShieldCheck size={14} />
                Основания доступны для проверки
              </span>
            </div>
          )}
          {ctx.currentTacticalScenario && (
            <Panel className="selected-scenario-banner">
              <div>
                <span className="eyebrow">Сравниваемое допущение тренера</span>
                <h3>{ctx.currentTacticalScenario.title}</h3>
                <p>{assumptionText(ctx.currentTacticalScenario)}</p>
              </div>
              <button
                className="text-button"
                onClick={() => ctx.go("/simulator")}
              >
                Вернуться к допущениям <ArrowUpRight size={15} />
              </button>
            </Panel>
          )}
          <div className="compact-context"><span>Приоритет проверки</span><InfoHint label="Как понимать приоритет рекомендации" text="Приоритет — ориентир штаба, а не вероятность успеха. Эффект нужно проверить в матчах. Формула и ограничения доступны в методологии и подробностях ранжирования." /></div>
          <div className="recommendations" data-team-id={out.team.team_id}>
            {primary && (
              <RecommendationCard
                rec={primary}
                index={out.recommendations.indexOf(primary)}
                selected={true}
                highlight
                showBrief={!embedded}
                onChoose={onChoose}
                chosenId={chosenId}
              />
            )}
          </div>
          <Disclosure title="Обсудить план с AI-аналитиком">
            <AIWorkspace />
          </Disclosure>
          <Disclosure title="Ещё два направления для сравнения">
            <div className="recommendations">
              {out.recommendations
                .filter((r) => r.id !== primary?.id)
                .slice(0, 2)
                .map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    rec={rec}
                    index={out.recommendations.indexOf(rec)}
                    selected={false}
                    showBrief={!embedded}
                    onChoose={onChoose}
                    chosenId={chosenId}
                  />
                ))}
            </div>
          </Disclosure>
          <ResearchDetails title="Как рассчитан приоритет: веса, чувствительность и ограничения">
            <div className="grid-two">
              <Panel
                title="Почему такой порядок"
                subtitle="Одинаковая прозрачная формула для всех направлений"
              >
                <ComparisonChart
                  horizontal
                  height={240}
                  data={out.recommendations.map((r, i) => ({
                    label: `${i + 1}. ${r.scenario_id === "quality" ? "Качество ударов" : r.scenario_id === "defense" ? "Защита центра" : r.scenario_id === "creation" ? "Создание моментов" : r.scenario_id === "combined" ? "Адаптация к стилю" : "Свой сценарий"}`,
                    score: r.score * 100,
                  }))}
                  bars={[
                    {
                      key: "score",
                      name: "Баллы приоритета / 100",
                      color: BLUE,
                    },
                  ]}
                />
                <p className="chart-note">{out.ranking.definition}</p>
              </Panel>
              <Panel
                title="Вес каждого основания"
                subtitle="Приоритет регулируется в панели контекста"
              >
                {Object.entries(out.ranking.weights).map(([key, weight]) => (
                  <div className="ranking-weight" key={key}>
                    <div>
                      <b>{metricName[key]}</b>
                      <span>{pct(weight, 0)}</span>
                    </div>
                    <div className="weight-track">
                      <span style={{ width: `${weight * 100}%` }} />
                    </div>
                    <p>{out.ranking.components[key]}</p>
                  </div>
                ))}
              </Panel>
            </div>
            <Disclosure title="Чувствительность ранжирования и ограничение ресурса">
              <p>{out.ranking.resource_assumption}</p>
              <p>
                Выбрано направлений: не более {out.ranking.max_interventions}.
                Для комбинированного изменения могут потребоваться два
                направления.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Рекомендация</th>
                      <th>Вес эффекта 20%</th>
                      <th>30%</th>
                      <th>40%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {out.recommendations.map((r) => (
                      <tr key={r.id}>
                        <td>{r.title}</td>
                        {r.score_sensitivity.map((s) => (
                          <td key={s.gain_weight}>{n(s.score * 100, 1)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                Это проверка чувствительности эвристического приоритета, а не
                статистический интервал.
              </p>
            </Disclosure>
            <Panel
              title="Как исследование поддерживает решение"
              subtitle="Измеренные данные, обученная модель и сценарные допущения имеют разные роли"
            >
              <div className="decision-chain">
                <div>
                  <span>01</span>
                  <h3>Наблюдение</h3>
                  <p>{out.measured}</p>
                </div>
                <ArrowRight />
                <div>
                  <span>02</span>
                  <h3>Проверка</h3>
                  <p>
                    {out.model_context.model_name}.{" "}
                    {out.model_context.test_comparison.interpretation}
                  </p>
                </div>
                <ArrowRight />
                <div>
                  <span>03</span>
                  <h3>Эксперимент</h3>
                  <p>
                    {out.modeled}. Затем — оценка в следующих матчах и
                    видеоразбор.
                  </p>
                </div>
              </div>
              <p className="chart-note">{out.model_context.note}</p>
            </Panel>
            <Disclosure title="Ограничения рекомендаций и фактическая уверенность">
              {out.limitations.map((t) => (
                <p key={t}>{t}</p>
              ))}
              <p>
                В историческом контексте диагностика и доказательства используют
                только более ранние матчи. Предматчевая база симулятора при
                выбранном историческом контексте ограничена более ранними
                матчами; ретроспективные рекомендации не выдаются за известные
                тогда решения.
              </p>
            </Disclosure>
          </ResearchDetails>
          <div className="action-row">
            <Action secondary onClick={() => ctx.go("/simulator")}>
              Сравнить альтернативы
            </Action>
            <Action secondary onClick={() => ctx.go("/opponents")}>
              Открыть сравнение с соперником
            </Action>
          </div>
        </>
      )}
    </>
  );
}
function assumptionText(
  s:
    | Pick<
        TacticalScenario,
        | "shot_volume_change"
        | "shot_quality_change"
        | "attack_xg_change"
        | "xga_reduction"
      >
    | Record<string, number>,
) {
  const keys = [
    "shot_volume_change",
    "shot_quality_change",
    "attack_xg_change",
    "xga_reduction",
  ] as const;
  return (
    keys
      .filter((k) => Number(s[k]) !== 0)
      .map((k) => `${metricName[k]}: ${signed(Number(s[k]) * 100, 0)}%`)
      .join(" · ") || "Без изменений относительно базы"
  );
}
function RecommendationCard({
  rec,
  index,
  selected,
  highlight = false,
  showBrief = true,
  onChoose,
  chosenId,
}: {
  rec: Recommendation;
  index: number;
  selected: boolean;
  highlight?: boolean;
  showBrief?: boolean;
  onChoose?: (choice: Pick<Recommendation, "id" | "title">) => void;
  chosenId?: string;
}) {
  const ctx = useApp();
  const scenario: TacticalScenario = {
    id: rec.scenario_id,
    title: rec.scenario_id === "custom" ? "Свой сценарий" : rec.title,
    shot_volume_change: rec.scenario_assumptions.shot_volume_change ?? 0,
    shot_quality_change: rec.scenario_assumptions.shot_quality_change ?? 0,
    attack_xg_change: rec.scenario_assumptions.attack_xg_change ?? 0,
    xga_reduction: rec.scenario_assumptions.xga_reduction ?? 0,
  };
  const match = ctx.matches?.find(
    (m) => m.match_id === rec.supporting_match_id,
  );
  return (
    <article
      data-evidence-match={rec.supporting_match_id}
      className={`recommendation-card ${highlight ? "light-surface" : ""} ${selected ? "scenario-selected" : ""}`}
    >
      <div className="recommendation-heading">
        <div className="recommendation-rank">
          {String(index + 1).padStart(2, "0")}
        </div>
        <div>
          <div className="recommendation-tags">
            {rec.selected_for_testing && (
              <span className="pill pill-mint">
                <Check size={13} />
                Рекомендуется к проверке
              </span>
            )}
            {!rec.eligible && (
              <span className="pill pill-amber">Требует больше ресурса</span>
            )}
          </div>
          <h2>{rec.title}</h2>
        </div>
        <div
          className="recommendation-score"
          title="Сравнительный приоритет проверки, не вероятность успеха"
        >
          <b>{n(rec.score * 100, 0)}</b>
          <span>баллов / 100</span>
        </div>
      </div>
      <p className="diagnosed-problem">{rec.diagnosed_problem}</p>
      <div className="coach-experiment">
        <span className="eyebrow">Тактический эксперимент</span>
        <p>{rec.experiment}</p>
      </div>
      <div className="evidence-grid compact-evidence">
        {rec.supporting_metrics.slice(0, 2).map((e) => (
          <EvidenceCard key={e.id} evidence={e} compact />
        ))}
      </div>
      <div className="recommendation-model compact-model">
        <div>
          <span className="eyebrow">Модельный потенциал</span>
          <strong>
            {signed(rec.modeled_delta_expected_points, 3)}{" "}
            <small>очк. / матч</small>
          </strong>
        </div>
        <p>
          {assumptionText(rec.scenario_assumptions)}.
        </p>
        <button
          className="text-button"
          onClick={() =>
            ctx.go("/simulator", { currentTacticalScenario: scenario })
          }
        >
          Проверить сценарий <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="evaluation-plan">
        <h3>Как проверить в следующих матчах</h3>
        <p>{rec.evaluation_plan}</p>
      </div>
      <Disclosure title="Риски, неопределённость и все основания">
        <p>{rec.evidence_quality.note}</p>
        <h3>Риски</h3>
        {rec.risks.map((t) => (
          <p key={t}>{t}</p>
        ))}
        {rec.uncertainty.map((t) => (
          <p key={t}>{t}</p>
        ))}
        <div className="evidence-grid">
          {rec.supporting_metrics.map((e) => (
            <EvidenceCard key={e.id} evidence={e} />
          ))}
        </div>
        <p>
          Компоненты балла:{" "}
          {Object.entries(rec.score_components)
            .map(([k, v]) => `${metricName[k]} ${n(v, 2)}`)
            .join(" · ")}
        </p>
      </Disclosure>
      <p className="evidence-criterion">{rec.evidence_match_criterion}</p>
      <div className="recommendation-actions">
        {onChoose && (
          <button
            className="button-primary"
            disabled={!rec.eligible || chosenId === rec.id}
            onClick={() => onChoose({ id: rec.id, title: rec.title })}
          >
            {chosenId === rec.id ? "Выбрано для сводки" : "Выбрать для сводки"}
          </button>
        )}
        <button
          className="text-button"
          disabled={!match}
          onClick={() => match && ctx.openMatch(match)}
        >
          Показать матч-доказательство <ArrowUpRight size={14} />
        </button>
        <button className="text-button" onClick={() => ctx.go("/opponents")}>
          Открыть сравнение с соперником <ArrowUpRight size={14} />
        </button>
        {showBrief && <CoachingBriefButton recommendationId={rec.id} />}
      </div>
    </article>
  );
}
