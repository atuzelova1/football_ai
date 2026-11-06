import { useEffect } from "react";
import {
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  ShieldCheck,
  Target,
  TriangleAlert,
} from "lucide-react";
import { useApi } from "../api";
import { useApp } from "../context";
import type { ModelMetrics, Prediction, TeamMatch } from "../types";
import {
  Action,
  ClubBadge,
  Disclosure,
  Empty,
  ErrorState,
  Kpi,
  Loading,
  Note,
  OpponentSelect,
  PageTitle,
  Panel,
  ProbabilityBars,
  ResearchDetails,
} from "../components";
import { BLUE, ComparisonChart } from "../charts";
import { clubName, date, n, pct, signed } from "../format";

export default function PredictionPage({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const ctx = useApp();
  const metrics = useApi<ModelMetrics>("/api/prediction/metrics");
  const allowed = new Set(metrics.data?.splits.test.match_ids ?? []);
  const eligible = ctx.matches?.filter((m) => allowed.has(m.match_id)) ?? [];
  const h = ctx.selectedHistoricalMatchContext;
  const historical =
    h && h.teamId === ctx.selectedClubId && allowed.has(h.matchId) ? h : null;
  const unsupported =
    !!ctx.selectedMatchId &&
    !!metrics.data &&
    !allowed.has(ctx.selectedMatchId) &&
    !historical;
  const body = historical
    ? {
        team_id: ctx.selectedClubId,
        opponent_id: historical.opponentId,
        match_id: historical.matchId,
      }
    : {
        team_id: ctx.selectedClubId,
        opponent_id: ctx.selectedOpponentId,
        is_home: ctx.isHome,
      };
  const api = useApi<Prediction>(
    "/api/prediction",
    body,
    !!metrics.data &&
      !!ctx.selectedOpponentId &&
      (!ctx.selectedMatchId || !!historical),
  );
  function choose(match?: TeamMatch) {
    ctx.update(
      match
        ? {
            selectedHistoricalMatchContext: {
              teamId: ctx.selectedClubId!,
              matchId: match.match_id,
              opponentId: match.opponent_id,
              date: match.match_date,
              isHome: !!match.is_home,
            },
            selectedOpponentId: match.opponent_id,
            selectedMatchId: match.match_id,
            isHome: !!match.is_home,
            currentTacticalScenario: null,
          }
        : {
            selectedHistoricalMatchContext: null,
            selectedMatchId: null,
            currentTacticalScenario: null,
          },
    );
  }
  useEffect(() => {
    if (!historical && ctx.selectedMatchId && metrics.data) {
      const match = eligible.find((m) => m.match_id === ctx.selectedMatchId);
      if (match) choose(match);
    }
  }, [ctx.selectedMatchId, ctx.selectedClubId, metrics.data, ctx.matches]);
  if (metrics.error)
    return <ErrorState error={metrics.error} retry={metrics.retry} />;
  if (!metrics.data || !ctx.matches) return <Loading />;
  const m = metrics.data,
    chosen = m.models[m.selected_model],
    result = api.data;
  return (
    <>
      {!embedded && (
        <PageTitle
          eyebrow="04 / ML-прогноз"
          title="Вероятности, а не обещания"
          description="Проверьте модель на невиденных исторических матчах или сравните клубы гипотетически."
        />
      )}
      <Panel
        title="Предматчевый контекст"
        subtitle="Историческая оценка разрешена только для тестовой выборки"
      >
        <div className="prediction-controls">
          <OpponentSelect />
          <label className="field wide-field">
            Контекст прогноза
            <select
              aria-label="Контекст прогноза"
              value={
                historical?.matchId ??
                (unsupported ? "unavailable" : "hypothetical")
              }
              onChange={(e) =>
                choose(
                  eligible.find((x) => x.match_id === Number(e.target.value)),
                )
              }
            >
              {unsupported && (
                <option value="unavailable" disabled>
                  Выбранный матч не входит в тестовую выборку
                </option>
              )}
              <option value="hypothetical">
                Гипотетическое сравнение по сезону 2015/16
              </option>
              {eligible.map((match) => (
                <option key={match.match_id} value={match.match_id}>
                  {date(match.match_date)} · {clubName(match.opponent_name)} ·{" "}
                  {match.is_home ? "дома" : "в гостях"}
                </option>
              ))}
            </select>
          </label>
          {!historical && (
            <label className="field">
              Поле
              <select
                aria-label="Поле прогноза"
                value={ctx.isHome ? "home" : "away"}
                onChange={(e) =>
                  ctx.update({ isHome: e.target.value === "home" })
                }
              >
                <option value="home">Дома</option>
                <option value="away">В гостях</option>
              </select>
            </label>
          )}
        </div>
        <div className="context-help">
          <span>
            <ShieldCheck size={14} />
            {eligible.length} допустимых тестовых матчей выбранного клуба
          </span>
          <button
            className="text-button"
            disabled={!eligible.length}
            onClick={() =>
              choose(
                eligible.find(
                  (x) => x.opponent_id === ctx.selectedOpponentId,
                ) ?? eligible[0],
              )
            }
          >
            Взять матч тестовой выборки <ArrowRight size={14} />
          </button>
        </div>
      </Panel>
      {unsupported ? (
        <Note warning>
          Выбранный матч использовался при разработке модели или не имеет
          достаточной истории. Его нельзя показать как невиденный прогноз.
          Выберите тестовую встречу в списке или явно переключитесь на
          гипотетическое сравнение.
        </Note>
      ) : api.error ? (
        <ErrorState error={api.error} retry={api.retry} />
      ) : !result ? (
        <Loading />
      ) : (
        <>
          <Panel className="prediction-result light-surface">
            <div className="prediction-top" data-team-id={result.team.team_id}>
              <div>
                <span className="pill pill-blue">
                  <BrainCircuit size={14} />
                  {historical
                    ? "Невиденный при обучении матч"
                    : "Гипотетический исторический анализ"}
                </span>
                <h2>
                  {clubName(ctx.club!.name)} <span>—</span>{" "}
                  {clubName(result.context.opponent.name)}
                </h2>
                <p>
                  {historical
                    ? date(historical.date)
                    : "На основе завершённого сезона 2015/16"}{" "}
                  · {result.context.is_home ? "Дома" : "В гостях"}
                </p>
              </div>
              <ClubBadge name={ctx.club!.name} large />
            </div>
            <ProbabilityBars value={result.probabilities} />
            <div className="prediction-bottom">
              <span>
                <ShieldCheck size={16} />
                {result.model_name}
              </span>
              <span>
                Последняя дата признаков:{" "}
                {date(result.context.latest_feature_date)}
              </span>
            </div>
          </Panel>
        </>
      )}
      <Note warning>
        Качество вероятностей не превысило базовую модель. Полнота распознавания ничьих:{" "}
        {pct(
          chosen.test.per_class.find((c) => c.label === "Ничья")?.recall ?? 0,
        )}
        .
      </Note>
      <ResearchDetails title="О модели: качество, хронология и ограничения">
        <div className="kpi-grid four">
          <Kpi
            label="Точность на тесте"
            value={pct(chosen.test.accuracy)}
            note={`95% бутстрэп: ${pct(chosen.test.accuracy_interval_95[0], 0)}–${pct(chosen.test.accuracy_interval_95[1], 0)}`}
            icon={<Target size={17} />}
          />
          <Kpi
            label="Макро-F1"
            value={n(chosen.test.macro_f1, 3)}
            note="Равный вес трёх классов"
          />
          <Kpi
            label="Логарифмическая ошибка"
            value={n(chosen.test.log_loss, 3)}
            note="Меньше — лучше"
            tone="amber"
          />
          <Kpi
            label="Будущая тестовая выборка"
            value={chosen.test.n}
            note="Уникальных матчей вне обучения"
            icon={<CalendarDays size={17} />}
          />
        </div>
        <div className="grid-main">
          <Panel
            title="Честное сравнение моделей"
            subtitle="Параметры и модель выбирались по валидации, а не по тесту"
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Модель</th>
                    <th>Точность</th>
                    <th>Макро-F1</th>
                    <th>Лог. ошибка</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(m.models).map(([key, model]) => (
                    <tr
                      key={key}
                      className={key === m.selected_model ? "selected-row" : ""}
                    >
                      <td>
                        {model.name}
                        {key === m.selected_model && (
                          <span className="table-selected">Выбрана</span>
                        )}
                      </td>
                      <td>{pct(model.test.accuracy)}</td>
                      <td>{n(model.test.macro_f1, 3)}</td>
                      <td>{n(model.test.log_loss, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Note warning>
              {m.test_comparison.interpretation} Изменение точности к базе:{" "}
              {signed(
                m.test_comparison.accuracy_improvement_over_prior * 100,
                1,
              )}{" "}
              п.п. Преимущество по одному показателю не доказывает общее
              превосходство.
            </Note>
          </Panel>
          <Panel
            title="Хронология проверки"
            subtitle="Календарные даты не пересекаются"
          >
            <div className="split-timeline">
              {(
                [
                  ["train", "Обучение"],
                  ["validation", "Валидация"],
                  ["test", "Тест"],
                ] as const
              ).map(([key, label], i) => (
                <div key={key} className={`split-block split-${key}`}>
                  <span>0{i + 1}</span>
                  <div>
                    <b>
                      {label} · {m.splits[key].n} матчей
                    </b>
                    <small>
                      {date(m.splits[key].start)} — {date(m.splits[key].end)}
                    </small>
                  </div>
                </div>
              ))}
            </div>
            <p className="chart-note">
              Финальная модель обучена на обучающей и валидационной частях до{" "}
              {date(m.fit_end)}.
            </p>
          </Panel>
        </div>
        <div className="grid-two">
          <Panel
            title="Матрица ошибок"
            subtitle="Фактический и предсказанный исход хозяев"
          >
            <div className="confusion-matrix">
              <span className="matrix-caption">Предсказанный исход →</span>
              <div className="matrix-grid">
                <span />
                {chosen.test.confusion_matrix.labels.map((label) => (
                  <span className="matrix-label" key={label}>
                    {label}
                  </span>
                ))}
                {chosen.test.confusion_matrix.values.map((row, i) => (
                  <div className="matrix-row" key={i}>
                    <span className="matrix-label">
                      {chosen.test.confusion_matrix.labels[i]}
                    </span>
                    {row.map((v, j) => (
                      <span
                        key={j}
                        className={`matrix-cell ${i === j ? "correct" : ""}`}
                        title={`Факт: ${chosen.test.confusion_matrix.labels[i]}; прогноз: ${chosen.test.confusion_matrix.labels[j]}; матчей ${v}`}
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
              <span className="tiny">
                Строки — фактический исход. Диагональ — верные ответы.
              </span>
            </div>
            <p className="chart-note">
              Метрики рассчитаны для хозяев один раз на матч. Вероятности выше
              переведены в перспективу выбранного клуба.
            </p>
          </Panel>
          <Panel
            title="На какие признаки опирается модель"
            subtitle="Глобальная важность; это не эффект тактического вмешательства"
          >
            <ol className="feature-list">
              {m.important_features.map((f) => (
                <li key={f.feature}>
                  <span>
                    {f.label.replace(
                      "Разница последних пяти матчей: ",
                      "Разница формы: ",
                    )}
                  </span>
                  <b>{n(f.importance, 3)}</b>
                </li>
              ))}
            </ol>
            <p className="chart-note">{m.importance_method}</p>
          </Panel>
        </div>
        <Disclosure title="Поклассовые результаты и вероятностная ошибка">
          <p>
            F1 — гармоническое среднее точности класса и полноты. Макро-F1
            усредняет F1 победы, ничьей и поражения с одинаковым весом.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Класс</th>
                  <th>Точность класса</th>
                  <th>Полнота</th>
                  <th>F1</th>
                  <th>Матчи</th>
                </tr>
              </thead>
              <tbody>
                {chosen.test.per_class.map((p) => (
                  <tr key={p.label}>
                    <td>{p.label}</td>
                    <td>{pct(p.precision)}</td>
                    <td>{pct(p.recall)}</td>
                    <td>{n(p.f1, 3)}</td>
                    <td>{p.support}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Многоклассовая ошибка Брайера: {n(chosen.test.brier_multiclass, 3)}.
            Средняя сумма квадратов ошибок трёх вероятностей, диапазон 0–2;
            меньше лучше.
          </p>
        </Disclosure>
        <Disclosure title="Диагностика калибровки вероятностей">
          <p>
            Сравнение средней вероятности с долей фактических исходов на тесте.
            Малые группы не позволяют делать устойчивые выводы; дополнительная
            калибровка на тесте не подбиралась.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Исход</th>
                  <th>Средняя вероятность</th>
                  <th>Доля исхода</th>
                  <th>Матчей</th>
                </tr>
              </thead>
              <tbody>
                {chosen.test.calibration.flatMap((c) =>
                  c.bins.map((b, i) => (
                    <tr key={`${c.class_label}:${i}`}>
                      <td>{c.class_label}</td>
                      <td>{pct(b.predicted)}</td>
                      <td>{pct(b.observed)}</td>
                      <td>{b.n}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </Disclosure>
        <Disclosure title="Как предотвращена утечка данных и что ограничивает прогноз">
          <p>
            ML — машинное обучение на более ранних матчах. Разные встречи одной
            команды могут быть зависимыми; уникальность строк не означает
            статистической независимости наблюдений.
          </p>
          {m.leakage_prevention.map((t) => (
            <p key={t}>{t}</p>
          ))}
          <p>{m.selection_rule}</p>
          {m.limitations.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </Disclosure>
      </ResearchDetails>
      <div className="next-step horizontal">
        <div>
          <div className="eyebrow">Следующий шаг / Решение</div>
          <h2>Что изменится при улучшении игры?</h2>
          <p>
            ML-классификатор и сценарная модель Пуассона используют разные
            предположения. Не смешивайте их вероятности.
          </p>
        </div>
        <Action onClick={() => ctx.go("/simulator")}>
          Перейти к тактическому плану
        </Action>
      </div>
    </>
  );
}
