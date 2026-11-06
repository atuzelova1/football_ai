import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  Crosshair,
  Flag,
  Shield,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";
import { useApi } from "../api";
import { useApp } from "../context";
import type { Overview, Research } from "../types";
import {
  Action,
  ClubBadge,
  Disclosure,
  Empty,
  ErrorState,
  EvidenceCard,
  Kpi,
  Loading,
  MatchCard,
  Note,
  PageTitle,
  Panel,
  ResultBadge,
  ResearchDetails,
} from "../components";
import { BLUE, RED, MINT, AMBER, ComparisonChart, TrendChart } from "../charts";
import { clubName, date, metricValue, metricUnit, n, pct, signed } from "../format";

export default function OverviewPage() {
  const ctx = useApp();
  const id = ctx.selectedClubId;
  const overview = useApi<Overview>(`/api/clubs/${id}/overview`),
    research = useApi<Research>(`/api/clubs/${id}/research`);
  const [trend, setTrend] = useState("attack"),
    [resultMetric, setResultMetric] = useState("xgd");
  const evidenceRef = useRef<HTMLElement>(null);
  const location = useLocation();
  useEffect(() => {
    const evidenceId = new URLSearchParams(location.search).get("evidence");
    if (evidenceId && !ctx.selectedResearchEvidence && research.data) {
      const found = research.data.evidence.find((e) => e.id === evidenceId);
      if (found) ctx.update({ selectedResearchEvidence: found });
    }
  }, [location.search, research.data, ctx.selectedResearchEvidence]);
  useEffect(() => {
    if (research.data && ctx.selectedResearchEvidence)
      evidenceRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  }, [research.data, ctx.selectedResearchEvidence]);
  if (overview.error || research.error)
    return (
      <ErrorState
        error={overview.error ?? research.error!}
        retry={() => {
          overview.retry();
          research.retry();
        }}
      />
    );
  if (!overview.data || !research.data) return <Loading />;
  const o = overview.data,
    r = research.data,
    s = o.summary;
  const diagnosis = o.coaching;
  const problemMatch = ctx.matches?.find(
    (m) => m.match_id === diagnosis.match_id,
  );
  const position = o.league_table.find((t) => t.team_id === id)?.position;
  const series = o.visuals.season_series.map((p) => ({ ...p }));
  const ownMatches = ctx.matches ?? [];
  const league = o.visuals.league_comparison.map((c) => ({
    ...c,
    league_index: 100,
  }));
  const home = o.home_away.map((h) => ({
    label: h.label,
    xg: h.summary.per_match.xg,
    xga: h.summary.per_match.xga,
    points: h.summary.per_match.points,
  }));
  const selectedEvidence =
    ctx.selectedResearchEvidence && ctx.selectedResearchEvidence.team_id === id
      ? ctx.selectedResearchEvidence
      : null;
  const byResult = r.comparisons.find((c) => c.metric === resultMetric)!;
  const correlation = r.correlations.find((c) => c.metric === resultMetric);
  return (
    <>
      <PageTitle
        eyebrow="Историческая тренерская лаборатория · 2015/16"
        title="Панель тренера"
        description="Что требует внимания и какое направление проверить с командой?"
      />
      <section className="club-hero" data-team-id={id}>
        <div className="hero-club">
          <ClubBadge name={o.team.name} large />
          <div>
            <h2>{clubName(o.team.name)}</h2>
            <p>
              {id === 360 ? "Исторический кейс: Райо Вальекано · " : ""}Ла Лига
              2015/16 · {position}-е место
            </p>
          </div>
        </div>
        <div className="hero-season-stats">
          <span>
            <b>{s.points}</b> очков
          </span>
          <span>
            <b>
              {s.goals_for}:{s.goals_against}
            </b>{" "}
            голы
          </span>
          <span>
            {s.matches} матчей · {s.wins} побед · {s.draws} ничьих · {s.losses}{" "}
            поражений
          </span>
        </div>
      </section>
      <section
        className="coach-diagnosis"
        aria-label="Главный вывод по команде"
      >
        <div>
          <span className="eyebrow">Главный вывод</span>
          <h2>{diagnosis.title}</h2>
          <p>{diagnosis.text}</p>
        </div>
        <div className="diagnosis-actions">
          <Action
            onClick={() => problemMatch && ctx.openMatch(problemMatch)}
            disabled={!problemMatch}
          >
            Разобрать матч-доказательство
          </Action>
          <button
            className="text-button"
            onClick={() => {
              const e = [...r.evidence,...(diagnosis.evidence ?? [])].find((e) => e.id === diagnosis.evidence_id);
              if (e) ctx.showEvidence(e);
            }}
          >
            Показать доказательства <ArrowUpRight size={16} />
          </button>
        </div>
      </section>
      <div className="kpi-grid five">
        <Kpi
          label="Созданный xG"
          value={n(s.xg)}
          note="Оценка всех созданных ударов"
        />
        <Kpi
          label="Допущенный xGA"
          value={n(s.xga)}
          note="Оценка моментов соперника"
          tone="amber"
        />
        <Kpi
          label="Разница xG"
          value={signed(s.xgd, 1)}
          note="Создано минус допущено"
        />
        <Kpi
          label="Удары за матч"
          value={n(s.per_match.shots)}
          note={`xG/удар ${n(s.shot_quality, 3)}`}
        />
        <Kpi
          label="Недобор очков"
          value={s.points_dropped}
          note={`До максимума: ${s.matches * 3} очков`}
        />
      </div>
      <div className="insight-grid">
        {r.findings.slice(0, 3).map((f) => (
          <article className="insight-card" key={f.id}>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
            <button
              className="text-button"
              onClick={() => {
                const e = r.evidence.find((e) => f.evidence_ids.includes(e.id));
                if (e) ctx.showEvidence(e);
              }}
            >
              Основания <ArrowRight size={16} />
            </button>
          </article>
        ))}
      </div>
      <div className="grid-main">
        <Panel
          title="Как менялось качество игры"
          subtitle="xG и xGA по матчам сезона; это оценки моментов, не счёт"
        >
          <TrendChart
            data={series}
            lines={[
              { key: "xg", name: "Созданный xG", color: BLUE },
              { key: "xga", name: "Допущенный xGA", color: AMBER },
            ]}
          />
        </Panel>
        <Panel
          title="Сравнение с лигой"
          subtitle="Среднее за матч; остальные 19 клубов"
        >
          <div className="benchmark-list">
            {o.visuals.league_comparison
              .filter((c) => ["xg", "xga", "shot_quality"].includes(c.metric))
              .map((c) => (
                <div key={c.metric}>
                  <span>{c.label}</span>
                  <strong>
                    {n(c.team, c.metric === "shot_quality" ? 3 : 2)}
                  </strong>
                  <small>
                    Лига: {n(c.league, c.metric === "shot_quality" ? 3 : 2)}
                  </small>
                </div>
              ))}
          </div>
          <p className="chart-note">
            Различие описательное: сила календаря не выровнена.
          </p>
        </Panel>
      </div>
      <Panel
        title="Матчи для проверки вывода"
        subtitle={
          diagnosis.match_selection?.criterion ??
          "Встречи без победы с заметным отклонением показателя"
        }
      >
        <div className="problem-matches">
          {(diagnosis.match_selection?.match_ids ?? [diagnosis.match_id])
            .map((mid) => ownMatches.find((m) => m.match_id === mid))
            .filter((m): m is NonNullable<typeof m> => !!m)
            .map((m) => (
              <MatchCard
                key={m.match_id}
                match={m}
                onClick={() => ctx.openMatch(m)}
              />
            ))}
        </div>
      </Panel>
      <ResearchDetails title="Сравнение с остальными клубами">
        {" "}
        <Panel
          title="Команда относительно лиги"
          subtitle="Индекс: средний уровень остальных клубов = 100"
        >
          <ComparisonChart
            data={league}
            horizontal
            height={260}
            reference={100}
            bars={[{ key: "index", name: "Индекс клуба", color: BLUE }]}
          />
          <p className="chart-note">{o.visuals.comparison_note}</p>
        </Panel>
      </ResearchDetails>
      <ResearchDetails title="Подробнее об исследовании: показатели по исходам">
        <Panel
          title="Какие показатели связаны с результатом"
          subtitle="Средние значения в победах, ничьих и поражениях — отдельное сравнение количества и качества"
          action={
            <label className="field">
              Показатель
              <select
                aria-label="Показатель по исходам"
                value={resultMetric}
                onChange={(e) => setResultMetric(e.target.value)}
              >
                {r.comparisons.map((c) => (
                  <option key={c.metric} value={c.metric}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          }
        >
          <ComparisonChart
            data={byResult.by_result.map((g) => ({
              label: `${g.result} · n=${g.n}`,
              mean: g.mean,
            }))}
            bars={[{ key: "mean", name: byResult.label, color: BLUE }]}
            valueFormatter={(v)=>metricValue(resultMetric,v)}
          />
          <p className="chart-note">
            Среднее клуба: {metricValue(resultMetric,byResult.team)}; остальных клубов:{" "}
            {metricValue(resultMetric,byResult.league_others)} ({metricUnit(resultMetric)}). Корреляция Спирмена с очками:{" "}
            {n(correlation?.spearman_with_points, 3)}. Доли точности и передач
            показаны в процентах. Доля передач — событийный прокси контроля
            мяча, а не время владения. Сравнение наблюдательное и не доказывает
            причинность.
          </p>
        </Panel>
      </ResearchDetails>
      <ResearchDetails title="Домашние и выездные матчи">
        {" "}
        <div className="home-context-grid">
          <Panel
            title="Дома и в гостях"
            subtitle="Средние значения на матч, по 19 наблюдений"
          >
            <ComparisonChart
              data={home}
              bars={[
                { key: "xg", name: "xG за матч", color: BLUE },
                { key: "xga", name: "xGA за матч", color: AMBER },
              ]}
            />
            <div className="home-points">
              {home.map((h) => (
                <span key={h.label}>
                  {h.label}: <b>{n(h.points, 2)} очка / матч</b>
                </span>
              ))}
            </div>
          </Panel>
        </div>
      </ResearchDetails>
      <ResearchDetails title="Все матчи сезона">
        <Panel
          title="Результаты по всему сезону"
          subtitle="Каждая ячейка открывает реальный матч"
        >
          <div className="season-results">
            {ownMatches.map((m) => (
              <button
                key={m.match_id}
                className={`season-result result-${m.result}`}
                title={`${date(m.match_date)} · ${clubName(m.opponent_name)} · ${m.goals_for}:${m.goals_against}`}
                aria-label={`Изучить этот матч: ${clubName(m.opponent_name)}, ${m.goals_for}:${m.goals_against}`}
                onClick={() => ctx.openMatch(m)}
              >
                <small>{m.match_week}</small>
                <b>
                  {m.goals_for}:{m.goals_against}
                </b>
                <span>{m.is_home ? "Д" : "Г"}</span>
              </button>
            ))}
          </div>
        </Panel>
      </ResearchDetails>
      <section
        ref={evidenceRef}
        className="evidence-section"
        aria-label="Доказательства исследования"
      >
        {selectedEvidence && (
          <Panel
            title="Выбранное доказательство"
            subtitle="Проследите связь показателя с реальными матчами"
            action={
              <button
                className="text-button"
                onClick={() => ctx.update({ selectedResearchEvidence: null })}
              >
                Снять выделение
              </button>
            }
          >
            <EvidenceCard evidence={selectedEvidence} />
            <div className="evidence-match-list">
              {ownMatches
                .filter((m) => selectedEvidence.match_ids.includes(m.match_id))
                .map((m) => (
                  <MatchCard
                    key={m.match_id}
                    match={m}
                    onClick={() => ctx.openMatch(m)}
                  />
                ))}
            </div>
          </Panel>
        )}
      </section>
      <ResearchDetails title="Научная проверка: гипотезы и ограничения">
        <Panel
          title="Научная проверка гипотез"
          subtitle="Четыре теста; значимость оценивается после поправки Holm"
        >
          <div className="hypothesis-grid">
            {r.hypotheses.map((h) => (
              <Disclosure key={h.id} title={h.question}>
                <div className="hypothesis-result">
                  <span
                    className={`pill ${h.significant ? "pill-mint" : "pill-amber"}`}
                  >
                    {h.significant
                      ? "Значимо после Holm"
                      : "Недостаточно оснований"}
                  </span>
                  <span>
                    p = {n(h.p_value, 4)} · p после Holm = {n(h.p_adjusted, 4)}
                  </span>
                </div>
                <p>
                  <b>H₀:</b> {h.h0}
                </p>
                <p>
                  <b>H₁:</b> {h.h1}
                </p>
                <p>
                  <b>Метод:</b> {h.method}
                </p>
                <p>
                  Объём выборки: {Object.values(h.sample_size).join(" / ")}.
                  Статистика: {n(h.statistic, 3)}.
                </p>
                {h.effect_size && (
                  <p>
                    {h.effect_size.name}: {n(h.effect_size.value, 3)}.
                  </p>
                )}
                {h.confidence_interval && (
                  <p>
                    95% интервал: [{n(h.confidence_interval.lower, 3)};{" "}
                    {n(h.confidence_interval.upper, 3)}].{" "}
                    {h.confidence_interval.method}.
                  </p>
                )}
                <p>{h.interpretation}</p>
                {h.limitations.map((t) => (
                  <p className="tiny" key={t}>
                    {t}
                  </p>
                ))}
                <p className="tiny">{h.correction}</p>
              </Disclosure>
            ))}
          </div>
        </Panel>
        <Disclosure title="Исследовательский вопрос, наблюдения и ограничения">
          <p>{r.problem.question}</p>
          <p>
            Пользователь: {r.problem.user}. Решение: {r.problem.decision}
          </p>
          <p>
            {s.matches} матчей клуба, {ctx.meta?.coverage.matches} матчей лиги.
            События и счёт записаны источником; xG оценён моделью StatsBomb,
            результаты сценариев моделируются.
          </p>
          {r.limitations.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </Disclosure>
      </ResearchDetails>
      <div className="next-step horizontal">
        <div>
          <h2>Перейти к подготовке</h2>
          <p>Проверьте соперника или сравните тактические гипотезы.</p>
        </div>
        <Action onClick={() => ctx.go("/opponents")}>
          Подготовиться к сопернику
        </Action>
      </div>
      <p className="tiny">{o.table_note}</p>
    </>
  );
}
function FlaskIcon() {
  return <Trophy size={13} />;
}
