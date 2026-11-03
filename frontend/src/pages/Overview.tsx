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
} from "../components";
import { BLUE, RED, MINT, AMBER, ComparisonChart, TrendChart } from "../charts";
import { clubName, date, n, pct, signed } from "../format";

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
        eyebrow="01 / Обзор команды"
        title="Игра за цифрами"
        description="Исследуйте, где команда теряет очки — и какие решения стоит проверить."
        action={
          <button
            className="text-button"
            onClick={() => ctx.setMethodologyOpen(true)}
          >
            О данных и методе <ArrowUpRight size={15} />
          </button>
        }
      />
      <section className="club-hero" data-team-id={o.team.team_id}>
        <div className="hero-main">
          <div className="eyebrow">
            <span className="status-dot" />
            Ла Лига · 2015/16 · Полный сезон
          </div>
          <div className="hero-club">
            <ClubBadge name={o.team.name} large />
            <div>
              <h2>{clubName(o.team.name)}</h2>
              <p>Тренерская исследовательская лаборатория</p>
            </div>
          </div>
          <div className="hero-season-stats">
            <div>
              <b>
                {position}
                <sup>место</sup>
              </b>
              <span>в наблюдаемой таблице</span>
            </div>
            <div>
              <b>
                {s.points}
                <sup>очков</sup>
              </b>
              <span>из {s.matches * 3} возможных</span>
            </div>
            <div>
              <b>
                {s.goals_for}
                <em>:</em>
                {s.goals_against}
              </b>
              <span>забито / пропущено</span>
            </div>
          </div>
        </div>
        <div className="hero-decision">
          <div className="hero-decision-top">
            <span className="mini-icon">
              <Sparkles size={20} />
            </span>
            <span>Ключевой вопрос исследования</span>
          </div>
          <h3>
            Почему {clubName(o.team.name)}
            <br />
            теряет очки?
          </h3>
          <p>
            <b>{s.points_dropped}</b> потерянных очков за сезон. Сопоставим
            результат с качеством моментов и защитой.
          </p>
          <button className="button-primary" onClick={() => ctx.go("/advisor")}>
            Перейти к тактическим решениям <ArrowUpRight size={16} />
          </button>
        </div>
      </section>
      <div className="season-strip">
        <span>
          <Flag size={15} />
          {s.matches} матчей
        </span>
        <span>
          <i className="dot" style={{ background: MINT }} />
          {s.wins} побед
        </span>
        <span>
          <i className="dot" style={{ background: AMBER }} />
          {s.draws} ничьих
        </span>
        <span>
          <i className="dot" style={{ background: RED }} />
          {s.losses} поражений
        </span>
        <div className="strip-separator" />
        <span className="tiny">Последние пять</span>
        <div className="flex gap-1">
          {o.recent_form.map((m) => (
            <button
              className="result-link"
              key={m.match_id}
              title={`Изучить матч: ${clubName(m.opponent_name)}, ${date(m.match_date)}`}
              onClick={() => ctx.openMatch(m)}
            >
              <ResultBadge result={m.result} />
            </button>
          ))}
        </div>
      </div>
      <div className="kpi-grid six">
        <Kpi
          label="Созданный xG"
          value={n(s.xg)}
          note="Качество всех ударов"
          icon={<Target size={17} />}
        />
        <Kpi
          label="Допущенный xGA"
          value={n(s.xga)}
          note="Опасность моментов соперника"
          tone="amber"
          icon={<Shield size={17} />}
        />
        <Kpi
          label="Разница xG"
          value={signed(s.xgd, 1)}
          note="Создание минус допущенные моменты"
          tone={s.xgd >= 0 ? "mint" : "red"}
          icon={<ChartNoAxesCombined size={17} />}
        />
        <Kpi
          label="Удары за матч"
          value={n(s.per_match.shots)}
          note={`${s.shots} ударов за сезон`}
          icon={<Crosshair size={17} />}
        />
        <Kpi
          label="Качество удара"
          value={n(s.shot_quality, 3)}
          note="ΣxG / Σударов за сезон"
          icon={<Target size={17} />}
        />
        <Kpi
          label="Опасные удары соперника"
          value={s.dangerous_against}
          note="Удары с xG ≥ 0,20"
          tone="red"
          icon={<Shield size={17} />}
        />
      </div>
      <div className="grid-main">
        <Panel
          title="Качество игры по ходу сезона"
          subtitle="Результат рядом с ожидаемыми голами — без выводов о причинности"
          action={
            <div className="segmented">
              {[
                ["attack", "Атака"],
                ["defense", "Защита"],
                ["form", "Форма"],
              ].map(([v, l]) => (
                <button
                  className={trend === v ? "active" : ""}
                  key={v}
                  onClick={() => setTrend(v)}
                >
                  {l}
                </button>
              ))}
            </div>
          }
        >
          {trend === "attack" ? (
            <TrendChart
              data={series}
              lines={[
                { key: "xg", name: "Созданный xG", color: BLUE },
                { key: "goals_for", name: "Забитые голы", color: MINT },
              ]}
            />
          ) : trend === "defense" ? (
            <TrendChart
              data={series}
              lines={[
                { key: "xga", name: "Допущенный xGA", color: AMBER },
                { key: "goals_against", name: "Пропущенные голы", color: RED },
              ]}
            />
          ) : (
            <TrendChart
              data={o.rolling.map((p, i) => ({ ...p, round: i + 1 }))}
              lines={[
                { key: "xgd", name: "Средняя разница xG", color: BLUE },
                { key: "points", name: "Средние очки", color: MINT },
              ]}
            />
          )}
          <p className="chart-note">
            {trend === "form"
              ? o.rolling_note
              : "По горизонтали — тур сезона. Наведите на график для точных значений."}
          </p>
        </Panel>
        <Panel title="Результат и ожидание" subtitle="Сумма за полный сезон">
          <ComparisonChart
            data={[
              { label: "Атака", actual: s.goals_for, expected: s.xg },
              { label: "Защита", actual: s.goals_against, expected: s.xga },
            ]}
            bars={[
              { key: "actual", name: "Голы", color: BLUE },
              { key: "expected", name: "xG / xGA", color: AMBER },
            ]}
          />
          <p className="chart-note">
            Расхождение включает реализацию и шум. Автоголы входят в счёт, но не
            в xG ударов.
          </p>
        </Panel>
      </div>
      <Panel
        title="Что скрывается за турнирной таблицей"
        subtitle="Автоматически рассчитанные наблюдения, связанные с исходными матчами"
        action={
          <span className="pill">
            <FlaskIcon />
            {r.hypotheses.length} гипотезы
          </span>
        }
      >
        <div className="insight-grid">
          {r.findings.map((f, i) => (
            <article className="insight-card" key={f.id}>
              <div className="insight-top">
                <span className="insight-number">0{i + 1}</span>
                <span
                  className={`tiny ${f.supported_pattern ? "text-amber" : ""}`}
                >
                  {f.supported_pattern
                    ? "Требует внимания"
                    : "Проверено в исследовании"}
                </span>
              </div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <small>
                {f.limitation ??
                  "Наблюдательное сравнение. Разница не доказывает причину потери очков."}
              </small>
              <button
                className="text-button"
                onClick={() => {
                  const e = r.evidence.find((e) =>
                    f.evidence_ids.includes(e.id),
                  );
                  if (e) ctx.showEvidence(e);
                }}
              >
                Показать доказательства <ArrowRight size={14} />
              </button>
            </article>
          ))}
        </div>
      </Panel>
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
        />
        <p className="chart-note">
          Среднее клуба: {n(byResult.team, 3)}; остальных клубов:{" "}
          {n(byResult.league_others, 3)}. Корреляция Спирмена с очками:{" "}
          {n(correlation?.spearman_with_points, 3)}. Доли точности и передач
          показаны в диапазоне 0–1. Доля передач — событийный прокси контроля
          мяча, а не время владения. Сравнение наблюдательное и не доказывает
          причинность.
        </p>
      </Panel>
      <div className="grid-two">
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
          </Panel>
        )}
      </section>
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
          События, xG и счёт измерены источником; результаты сценариев
          моделируются.
        </p>
        {r.limitations.map((t) => (
          <p key={t}>{t}</p>
        ))}
      </Disclosure>
      <div className="grid-two">
        <Panel
          title="Последние матчи"
          subtitle="Откройте встречу для исследования эпизодов"
          action={
            <button className="text-button" onClick={() => ctx.go("/matches")}>
              Все матчи <ArrowUpRight size={15} />
            </button>
          }
        >
          {ownMatches
            .slice(-3)
            .reverse()
            .map((m) => (
              <MatchCard
                key={m.match_id}
                match={m}
                onClick={() => ctx.openMatch(m)}
              />
            ))}
        </Panel>
        <div className="next-step">
          <span className="eyebrow">Следующий шаг</span>
          <h2>
            От наблюдения —<br />к тактической гипотезе
          </h2>
          <p>
            Сначала проверьте конкретный матч и стиль соперника. Затем сравните
            возможные изменения.
          </p>
          <div className="flex flex-wrap gap-2">
            <Action secondary onClick={() => ctx.go("/matches")}>
              Исследовать матчи
            </Action>
            <Action secondary onClick={() => ctx.go("/opponents")}>
              Сравнить с соперниками
            </Action>
          </div>
        </div>
      </div>
      <p className="tiny">{o.table_note}</p>
    </>
  );
}
function FlaskIcon() {
  return <Trophy size={13} />;
}
