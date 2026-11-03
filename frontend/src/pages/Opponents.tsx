import {
  ArrowUpRight,
  Radar as RadarIcon,
  Shield,
  Target,
  Users,
} from "lucide-react";
import { useApi } from "../api";
import { useApp } from "../context";
import type { Opponents, StyleGroup } from "../types";
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
} from "../components";
import {
  AMBER,
  BLUE,
  ComparisonChart,
  ClusterScatter,
  StyleRadar,
} from "../charts";
import { clubName, date, metricName, n } from "../format";

export default function OpponentsPage() {
  const ctx = useApp();
  const api = useApi<Opponents>(
    `/api/clubs/${ctx.selectedClubId}/opponents?opponent_id=${ctx.selectedOpponentId}`,
    undefined,
    !!ctx.selectedOpponentId,
  );
  if (api.error) return <ErrorState error={api.error} retry={api.retry} />;
  if (!api.data) return <Loading />;
  const o = api.data,
    op = o.opponent_context!,
    cluster = o.style_model.clusters.find(
      (c) => c.cluster_id === op.cluster_id,
    )!;
  const group = o.against_styles.find((c) => c.cluster_id === op.cluster_id);
  const worst = o.against_styles
    .filter((g) => g.points_per_match != null)
    .sort((a, b) => a.points_per_match! - b.points_per_match!)[0];
  const benchmark = o.visuals.radar.map((r) => ({
    label: metricName[r.metric],
    team: r.team,
    opponent: r.opponent,
  }));
  const matches =
    ctx.matches?.filter((m) => m.opponent_id === ctx.selectedOpponentId) ?? [];
  return (
    <>
      <PageTitle
        eyebrow="03 / Анализ соперников"
        title="Понять другую сторону"
        description="Событийные стили, похожие клубы и реальные сложности в противостояниях."
      />
      <div className="context-toolbar">
        <OpponentSelect />
        <div className="toolbar-context">
          <ClubBadge name={ctx.club!.name} />
          <span>
            {clubName(ctx.club!.name)} <b>против</b>{" "}
            {clubName(op.opponent.name)}
          </span>
        </div>
        <Action secondary onClick={() => ctx.go("/prediction")}>
          Прогноз против этого соперника
        </Action>
      </div>
      <div className="opponent-hero" data-team-id={o.team.team_id}>
        <div className="flex items-center gap-4">
          <ClubBadge name={op.opponent.name} large />
          <div>
            <div className="eyebrow">Профиль соперника · Полный сезон</div>
            <h2>{clubName(op.opponent.name)}</h2>
            <p>
              Группа {op.cluster_id + 1}: {cluster.name}
            </p>
          </div>
        </div>
        <span className="pill pill-blue">
          <RadarIcon size={15} />
          {cluster.team_ids.length} клуба в группе
        </span>
      </div>
      <div className="kpi-grid four">
        <Kpi
          label="Передачи за матч"
          value={n(op.profile.passes, 0)}
          note="Событийная частота"
          icon={<Users size={17} />}
        />
        <Kpi
          label="Удары за матч"
          value={n(op.profile.shots, 1)}
          note="Объём завершения атак"
          icon={<Target size={17} />}
        />
        <Kpi
          label="Качество удара"
          value={n(op.profile.shot_quality, 3)}
          note="Средний xG удара"
        />
        <Kpi
          label="Защитные события"
          value={n(op.profile.defensive_events, 1)}
          note="События за матч"
          tone="amber"
          icon={<Shield size={17} />}
        />
      </div>
      <div className="grid-two">
        <Panel
          title="Карта игровых профилей"
          subtitle="20 клубов; нажмите на точку для выбора соперника"
        >
          <ClusterScatter value={o} />
          <p className="chart-note">
            Кластеры рассчитаны по семи стандартизованным показателям. Здесь
            показана проекция только на передачи и удары.
          </p>
        </Panel>
        <Panel
          title="Профиль противостояния"
          subtitle="Все оси нормированы независимо в диапазоне 0–100"
        >
          <StyleRadar value={o} />
          <p className="chart-note">{o.visuals.normalization}</p>
        </Panel>
      </div>
      <Note warning>
        {o.style_model.reliability_warning} Силуэт:{" "}
        {n(o.style_model.silhouette, 3)}. Бутстрэп ARI:{" "}
        {n(o.style_model.bootstrap_stability.median_ari, 2)}; устойчивость меток
        не доказывает тактическую причинность.
      </Note>
      <div className="grid-main">
        <Panel
          title="Результаты против разных стилей"
          subtitle="Средние очки и качество моментов выбранного клуба"
        >
          <div className="style-group-grid">
            {o.against_styles.map((g) => (
              <StyleCard
                key={g.cluster_id}
                group={g}
                active={g.cluster_id === op.cluster_id}
                onMatch={() => {
                  const m = ctx.matches?.find((m) =>
                    g.match_ids.includes(m.match_id),
                  );
                  if (m) ctx.openMatch(m);
                }}
              />
            ))}
          </div>
        </Panel>
        <Panel
          title="Где требовалось больше внимания"
          subtitle="Описательная связь с потерей очков"
        >
          {worst ? (
            <>
              <span className="pill pill-amber">
                Группа {worst.cluster_id + 1} · {worst.matches} матчей
              </span>
              <h3 className="mt-4">Меньше всего очков — против этой группы</h3>
              <p className="body-copy">
                {n(worst.points_per_match, 2)} очка за матч. Созданный xG:{" "}
                {n(worst.xg, 2)}, допущенный: {n(worst.xga, 2)}.
              </p>
              <p className="muted small">
                {worst.name}. Эффект может отражать силу состава и календарь. В
                малой группе вывод особенно неустойчив.
              </p>
              <Action secondary onClick={() => ctx.go("/simulator")}>
                Сравнить тактические сценарии
              </Action>
            </>
          ) : (
            <Empty />
          )}
        </Panel>
      </div>
      <div className="grid-two">
        <Panel
          title="Атака и стиль в одном масштабе"
          subtitle="Нормированные показатели, не рейтинг силы"
        >
          <ComparisonChart
            data={benchmark}
            horizontal
            height={340}
            bars={[
              { key: "team", name: "Выбранный клуб", color: BLUE },
              { key: "opponent", name: "Соперник", color: AMBER },
            ]}
          />
        </Panel>
        <Panel
          title="Похожие на выбранного соперника"
          subtitle="Евклидово расстояние стандартизованных профилей"
        >
          <div className="similar-list">
            {o.similar_opponents.map((c) => (
              <button
                key={c.team_id}
                disabled={c.team_id === ctx.selectedClubId}
                onClick={() => ctx.setOpponent(c.team_id)}
              >
                <ClubBadge name={c.name} />
                <span>
                  <b>{clubName(c.name)}</b>
                  <small>
                    Расстояние {n(c.distance, 2)} · группа {c.cluster_id + 1}
                  </small>
                </span>
                {c.team_id === ctx.selectedClubId ? (
                  <span className="tiny">Ваш клуб</span>
                ) : (
                  <ArrowUpRight size={17} />
                )}
              </button>
            ))}
          </div>
          <p className="chart-note">
            Близость означает сходство событийных признаков за сезон.
            Тактические системы могут различаться.
          </p>
        </Panel>
      </div>
      <Panel
        title="Личные встречи"
        subtitle="Наблюдаемый матчап в сезоне 2015/16"
      >
        <div className="head-to-head-grid">
          {matches.map((m) => (
            <button
              key={m.match_id}
              className="head-to-head"
              onClick={() => ctx.openMatch(m)}
            >
              <span>
                {date(m.match_date)} · {m.is_home ? "Дома" : "В гостях"}
              </span>
              <b>
                {clubName(ctx.club!.name)}{" "}
                <strong>
                  {m.goals_for}:{m.goals_against}
                </strong>{" "}
                {clubName(op.opponent.name)}
              </b>
              <small>
                xG {n(m.xg, 2)} : {n(m.xga, 2)}
              </small>
              <span className="text-blue">
                Открыть связанный матч <ArrowUpRight size={14} />
              </span>
            </button>
          ))}
        </div>
      </Panel>
      <Disclosure title="Как выбраны группы и насколько они надёжны">
        <p>
          Сезонных профилей: {o.style_model.sample_size}. Итоговое число групп:{" "}
          {o.style_model.selected_k}.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Групп</th>
                <th>Силуэт</th>
                <th>Размеры</th>
                <th>Все ≥ 3 клуба</th>
              </tr>
            </thead>
            <tbody>
              {o.style_model.candidates.map((c) => (
                <tr key={c.k}>
                  <td>{c.k}</td>
                  <td>{n(c.silhouette, 3)}</td>
                  <td>{c.cluster_sizes.join(" / ")}</td>
                  <td>{c.eligible ? "Да" : "Нет"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>{o.style_model.alternative_block_evaluation.unit}</p>
        <p>
          Дополнительно проверено{" "}
          {o.style_model.alternative_block_evaluation.profiles} блоковых
          профилей. {o.style_model.alternative_block_evaluation.limitation}
        </p>
        {o.style_model.limitations.map((t) => (
          <p key={t}>{t}</p>
        ))}
      </Disclosure>
      <Disclosure title="Сравнить центры игровых групп">
        <ComparisonChart
          horizontal
          height={330}
          data={o.visuals.cluster_comparison.map((c) => ({
            label: metricName[c.metric],
            ...c.values,
          }))}
          bars={o.style_model.clusters.map((c, i) => ({
            key: `group_${c.cluster_id}`,
            name: `Группа ${c.cluster_id + 1}`,
            color: i === 0 ? BLUE : AMBER,
          }))}
        />
        <p>
          {o.visuals.normalization} Показаны реальные центры K-Means,
          переведённые обратно в исходные единицы и затем нормированные для
          общей оси.
        </p>
      </Disclosure>
      {group && group.matches < 8 && (
        <Note warning>
          В выбранной группе только {group.matches} матчей клуба. Используйте
          наблюдение для подготовки видеоразбора, а не как устойчивый закон
          матчапа.
        </Note>
      )}
    </>
  );
}
function StyleCard({
  group: g,
  active,
  onMatch,
}: {
  group: StyleGroup;
  active: boolean;
  onMatch: () => void;
}) {
  return (
    <article className={`style-card ${active ? "selected" : ""}`}>
      <div className="flex justify-between gap-2">
        <span className="eyebrow">Группа {g.cluster_id + 1}</span>
        <span className={`pill ${g.matches < 8 ? "pill-amber" : ""}`}>
          {g.matches} матчей
        </span>
      </div>
      <h3>{g.name}</h3>
      <div className="style-points">
        <b>{n(g.points_per_match, 2)}</b>
        <span>очка за матч</span>
      </div>
      <div className="style-xg">
        <span>
          xG <b>{n(g.xg, 2)}</b>
        </span>
        <span>
          xGA <b>{n(g.xga, 2)}</b>
        </span>
      </div>
      <button
        className="text-button mt-4"
        onClick={onMatch}
        disabled={!g.matches}
      >
        Открыть связанный матч <ArrowUpRight size={14} />
      </button>
    </article>
  );
}
