import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Goal,
  MapPin,
  Shield,
  Target,
} from "lucide-react";
import { useApi } from "../api";
import { useApp } from "../context";
import type { MatchAnalysis } from "../types";
import {
  Action,
  ClubBadge,
  Disclosure,
  Empty,
  ErrorState,
  Kpi,
  Loading,
  MatchCard,
  Note,
  PageTitle,
  Panel,
  ResultBadge,
  ResearchDetails,
} from "../components";
import {
  BLUE,
  AMBER,
  MINT,
  RED,
  ComparisonChart,
  PassingHeatmap,
  ShotPitch,
  TrendChart,
} from "../charts";
import { clubName, date, n, pct } from "../format";

export default function MatchesPage() {
  const ctx = useApp();
  const [result, setResult] = useState("all"),
    [venue, setVenue] = useState("all");
  const list =
    ctx.matches?.filter(
      (m) =>
        (result === "all" || m.result === result) &&
        (venue === "all" || m.is_home === Number(venue)),
    ) ?? [];
  const selected =
    list.find((m) => m.match_id === ctx.selectedMatchId) ??
    list.filter((m) => m.opponent_id === ctx.selectedOpponentId).at(-1) ??
    list.at(-1);
  const api = useApi<MatchAnalysis>(
    `/api/matches/${selected?.match_id}/analysis?team_id=${ctx.selectedClubId}`,
    undefined,
    !!selected,
  );
  useEffect(() => {
    setResult("all");
    setVenue("all");
  }, [ctx.selectedClubId]);
  useEffect(() => {
    if (
      ctx.matches &&
      ((selected?.match_id ?? null) !== ctx.selectedMatchId ||
        (selected &&
          (ctx.selectedOpponentId !== selected.opponent_id ||
            ctx.isHome !== !!selected.is_home)))
    )
      ctx.update({
        selectedMatchId: selected?.match_id ?? null,
        ...(selected
          ? {
              selectedOpponentId: selected.opponent_id,
              isHome: !!selected.is_home,
              selectedHistoricalMatchContext: selected
                ? ctx.historicalForMatch(selected)
                : null,
            }
          : {}),
      });
  }, [
    selected?.match_id,
    ctx.selectedMatchId,
    ctx.matches,
    ctx.selectedOpponentId,
    ctx.isHome,
  ]);
  if (ctx.matchesError)
    return <ErrorState error={ctx.matchesError} retry={ctx.retryMatches} />;
  if (!ctx.matches) return <Loading />;
  const a = api.data,
    own = a?.teams.find((t) => t.team_id === ctx.selectedClubId),
    opp = a?.teams.find((t) => t.team_id !== ctx.selectedClubId);
  const goOpponent = () =>
    ctx.go("/opponents", { selectedOpponentId: opp!.team_id });
  const matchPatch = selected
    ? {
        selectedMatchId: selected.match_id,
        selectedOpponentId: selected.opponent_id,
        isHome: !!selected.is_home,
        selectedHistoricalMatchContext: ctx.historicalForMatch(selected),
      }
    : {};
  return (
    <>
      <PageTitle
        eyebrow="02 / Анализ матчей"
        title="Разбор матчей"
        description="Сопоставьте счёт с моментами. Найдите эпизоды, которые стоит разобрать с командой."
      />
      <div className="match-laboratory">
        <aside className="match-list-panel">
          <Panel
            title="Матчи команды"
            subtitle={`${ctx.matches.length} встреч · сезон 2015/16`}
          >
            <div className="match-filters">
              <label className="field">
                Результат
                <select
                  aria-label="Фильтр по результату"
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                >
                  <option value="all">Все результаты</option>
                  <option value="W">Победы</option>
                  <option value="D">Ничьи</option>
                  <option value="L">Поражения</option>
                </select>
              </label>
              <label className="field">
                Поле
                <select
                  aria-label="Фильтр по полю"
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                >
                  <option value="all">Дома и в гостях</option>
                  <option value="1">Дома</option>
                  <option value="0">В гостях</option>
                </select>
              </label>
            </div>
            <div className="match-list" aria-label="Список матчей">
              {list.length ? (
                list
                  .slice()
                  .reverse()
                  .map((m) => (
                    <MatchCard
                      key={m.match_id}
                      match={m}
                      active={selected?.match_id === m.match_id}
                      onClick={() =>
                        ctx.update({
                          selectedMatchId: m.match_id,
                          selectedOpponentId: m.opponent_id,
                          isHome: !!m.is_home,
                          selectedHistoricalMatchContext:
                            ctx.historicalForMatch(m),
                        })
                      }
                    />
                  ))
              ) : (
                <Empty>Матчей с такими фильтрами нет.</Empty>
              )}
            </div>
          </Panel>
        </aside>
        <div className="match-detail">
          {!selected ? (
            <Empty title="Нет матчей с такими фильтрами">
              Выберите другой результат или поле.
            </Empty>
          ) : api.error ? (
            <ErrorState error={api.error} retry={api.retry} />
          ) : !a || !own || !opp ? (
            <Loading />
          ) : (
            <>
              <section
                className="match-score-header"
                data-team-id={a.team.team_id}
                data-opponent-id={opp.team_id}
              >
                <div className="match-meta">
                  <span>
                    <CalendarDays size={13} />
                    {date(a.match.match_date)}
                  </span>
                  <span>
                    <MapPin size={13} />
                    {own.is_home ? "Домашний матч" : "Выездной матч"}
                  </span>
                  <span>Тур {a.match.match_week}</span>
                </div>
                <div className="scoreline">
                  <div>
                    <ClubBadge name={own.name} large />
                    <b>{clubName(own.name)}</b>
                  </div>
                  <div className="score-main">
                    <strong>
                      {own.goals_for}
                      <em>:</em>
                      {own.goals_against}
                    </strong>
                    <span>
                      <ResultBadge result={own.result} />
                      {own.result_label}
                    </span>
                  </div>
                  <div>
                    <ClubBadge name={opp.name} large />
                    <b>{clubName(opp.name)}</b>
                  </div>
                </div>
                <div className="match-xg-score">
                  Ожидаемые голы <b>{n(own.xg, 2)}</b>
                  <span>:</span>
                  <b>{n(own.xga, 2)}</b>
                </div>
              </section>
              <Panel
                title="Почему этот матч заслуживает внимания?"
                className="light-surface match-brief"
              >
                <h3>{a.visuals.coaching.issue}</h3>
                <div className="match-patterns">
                  {a.visuals.coaching.patterns.map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                </div>
                <Disclosure title="Как описывается разница xG">
                  <p>{a.visuals.coaching.xg_comparison.note}</p>
                </Disclosure>
                <div className="action-row">
                  <Action secondary onClick={goOpponent}>
                    Анализировать соперника
                  </Action>
                  <Action onClick={() => ctx.go("/simulator", matchPatch)}>
                    Сравнить тактические решения
                  </Action>
                  <button
                    className="text-button"
                    onClick={() => ctx.go("/advisor", matchPatch)}
                  >
                    Спросить AI-советника <ArrowUpRight size={14} />
                  </button>
                </div>
              </Panel>
              <div className="kpi-grid four">
                <Kpi
                  label="Удары"
                  value={`${own.shots} : ${own.shots_against}`}
                  note="Команда / соперник"
                  icon={<Target size={16} />}
                />
                <Kpi
                  label="В створ"
                  value={`${own.shots_on_target} : ${opp.shots_on_target}`}
                  note="По исходу события удара"
                  icon={<Goal size={16} />}
                />
                <Kpi
                  label="Реализация"
                  value={pct(own.conversion)}
                  note="Голы из ударов / удары"
                  tone="mint"
                />
                <Kpi
                  label="Опасные удары допущены"
                  value={own.dangerous_against}
                  note="xG каждого ≥ 0,20"
                  tone="red"
                  icon={<Shield size={16} />}
                />
              </div>
              <Panel
                title="География моментов"
                subtitle="Исходные координаты StatsBomb · направление атак каждой стороны отражено"
              >
                <ShotPitch analysis={a} />
              </Panel>

              <Panel
                title="Как накапливался xG"
                subtitle="Суммарный xG по минутам; время округлено до минуты"
              >
                <TrendChart
                  x="minute"
                  data={a.visuals.xg_timeline}
                  lines={[
                    { key: "team_xg", name: clubName(own.name), color: BLUE },
                    {
                      key: "opponent_xg",
                      name: clubName(opp.name),
                      color: AMBER,
                    },
                  ]}
                />
              </Panel>
              <ResearchDetails title="Подробности матча: передачи, зоны и защита">
                <Panel
                  title="Какие показатели могут объяснять потерю очков?"
                  className="interpretation-panel"
                >
                  <p className="interpretation">{a.visuals.interpretation}</p>
                  <div className="action-row">
                    <Action secondary onClick={goOpponent}>
                      Изучить этого соперника
                    </Action>
                    <Action onClick={() => ctx.go("/simulator", matchPatch)}>
                      Проверить тактический сценарий
                    </Action>
                  </div>
                </Panel>{" "}
                <div className="grid-two">
                  <Panel
                    title="Количество и качество ударов"
                    subtitle="Число ударов в диапазоне xG"
                  >
                    <ComparisonChart
                      data={a.visuals.quality_distribution}
                      bars={[
                        { key: "team", name: "Команда", color: BLUE },
                        { key: "opponent", name: "Соперник", color: AMBER },
                      ]}
                    />
                  </Panel>
                  <Panel
                    title="Из каких зон возникала опасность"
                    subtitle="xG ударов по зонам штрафной"
                  >
                    <ComparisonChart
                      data={a.visuals.attack_zones}
                      horizontal
                      bars={[
                        { key: "team_xg", name: "Созданный xG", color: BLUE },
                        {
                          key: "opponent_xg",
                          name: "Допущенный xG",
                          color: AMBER,
                        },
                      ]}
                    />
                  </Panel>
                </div>
                <div className="grid-two">
                  <Panel
                    title="Карта направлений передач"
                    subtitle={`${clubName(own.name)} · частота переходов между зонами`}
                  >
                    <PassingHeatmap value={a} />
                  </Panel>
                  <Panel
                    title="Пас и защитная работа"
                    subtitle="События, а не трекинг движения игроков"
                  >
                    <div className="stat-comparison-header">
                      <span>Показатель</span>
                      <span>Команда</span>
                      <span>Соперник</span>
                    </div>
                    {[
                      ["Передачи", n(own.passes, 0), n(opp.passes, 0)],
                      [
                        "Завершённые",
                        n(own.completed_passes, 0),
                        n(opp.completed_passes, 0),
                      ],
                      [
                        "Точность",
                        pct(own.pass_accuracy),
                        pct(opp.pass_accuracy),
                      ],
                      [
                        "Прогрессивные",
                        n(own.progressive_passes, 0),
                        n(opp.progressive_passes, 0),
                      ],
                      [
                        "Защитные события",
                        n(own.defensive_events, 0),
                        n(opp.defensive_events, 0),
                      ],
                      [
                        "Возвраты мяча",
                        n(own.ball_recoveries, 0),
                        n(opp.ball_recoveries, 0),
                      ],
                    ].map(([label, v, w]) => (
                      <div key={label} className="stat-comparison-row">
                        <span>{label}</span>
                        <b>{v}</b>
                        <b>{w}</b>
                      </div>
                    ))}
                    <p className="chart-note">
                      Защитные события — единоборства, перехваты, блоки и
                      выносы. Их число не измеряет компактность или
                      эффективность прессинга.
                    </p>
                  </Panel>
                </div>
                <Note>
                  Карта показывает реальные удары, а не все потенциальные
                  моменты. {a.coordinate_note}
                </Note>
              </ResearchDetails>
              <div className="action-row">
                <Action onClick={() => ctx.go("/advisor", matchPatch)}>
                  Показать рекомендации
                </Action>
                <Action
                  secondary
                  onClick={() => ctx.go("/prediction", matchPatch)}
                >
                  Открыть контекст прогноза
                </Action>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
