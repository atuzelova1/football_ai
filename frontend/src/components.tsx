import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Info,
  RefreshCw,
  TriangleAlert,
  X,
  Database,
  FlaskConical,
  ShieldCheck,
  Search,
  Layers3,
} from "lucide-react";
import type { Evidence, Probabilities, TeamMatch } from "./types";
import { clubName, date, n, pct, resultName, resultShort } from "./format";
import { useApp } from "./context";

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
  id,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`panel ${className}`}>
      {(title || action) && (
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Action({
  children,
  onClick,
  secondary = false,
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  secondary?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${secondary ? "button-secondary" : "button-primary"} ${className}`}
    >
      {children}
      <ArrowUpRight size={16} />
    </button>
  );
}
export function Kpi({
  label,
  value,
  note,
  icon,
  tone = "blue",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
  tone?: string;
}) {
  return (
    <div className={`kpi tone-${tone}`}>
      <div className="kpi-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
export function Empty({
  title = "Нет наблюдений",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Search size={26} />
      <h3>{title}</h3>
      <p>{children ?? "Измените выбранный контекст или фильтры."}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading-grid" role="status" aria-label="Загрузка данных">
      <div className="skeleton wide" />
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton wide tall" />
      <span className="sr-only">Загрузка реальных данных…</span>
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: string;
  retry: () => void;
}) {
  return (
    <div role="alert" className="error-state">
      <TriangleAlert />
      <h2>Данные пока недоступны</h2>
      <p>{error}</p>
      <button className="button-secondary" onClick={retry}>
        <RefreshCw size={16} />
        Повторить запрос
      </button>
    </div>
  );
}
export function Note({
  children,
  warning = false,
}: {
  children: ReactNode;
  warning?: boolean;
}) {
  return (
    <div className={`note ${warning ? "note-warning" : ""}`}>
      {warning ? <TriangleAlert size={17} /> : <Info size={17} />}
      <div>{children}</div>
    </div>
  );
}
export function Disclosure({
  title,
  children,
  open = false,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="disclosure" open={open || undefined}>
      <summary>
        {title}
        <span>+</span>
      </summary>
      <div>{children}</div>
    </details>
  );
}
export function ResultBadge({ result }: { result: string }) {
  return (
    <span
      className={`result-badge result-${result}`}
      title={resultName(result)}
    >
      {resultShort(result)}
    </span>
  );
}
export function ClubBadge({
  name,
  large = false,
}: {
  name: string;
  large?: boolean;
}) {
  return (
    <span className={`club-badge ${large ? "large" : ""}`} aria-hidden="true">
      <span>
        {clubName(name)
          .split(" ")
          .slice(0, 2)
          .map((x) => x[0])
          .join("")}
      </span>
    </span>
  );
}
export function MatchCard({
  match,
  onClick,
  active = false,
}: {
  match: TeamMatch;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      className={`match-card ${active ? "selected" : ""}`}
      onClick={onClick}
    >
      <div>
        <small>
          {date(match.match_date)} · {match.is_home ? "Дома" : "В гостях"}
        </small>
        <span>{clubName(match.opponent_name)}</span>
      </div>
      <strong>
        {match.goals_for}:{match.goals_against}
      </strong>
      <ResultBadge result={match.result} />
      <ArrowRight size={15} />
    </button>
  );
}
export function EvidenceCard({
  evidence,
  compact = false,
}: {
  evidence: Evidence;
  compact?: boolean;
}) {
  const { showEvidence, go, matches } = useApp();
  const supportingMatch = matches?.find((m) =>
    evidence.match_ids.includes(m.match_id),
  );
  const percent = [
    "pass_accuracy",
    "pass_share",
    "central_xga_share",
    "shot_quality",
  ].includes(evidence.metric);
  const format = (v: number | null) =>
    percent && evidence.metric !== "shot_quality"
      ? pct(v)
      : n(v, evidence.metric === "shot_quality" ? 3 : 2);
  return (
    <div
      className={`evidence-card ${compact ? "compact" : ""}`}
      id={evidence.id}
    >
      <div className="evidence-caption">
        <Database size={14} />
        <span>{evidence.kind}</span>
      </div>
      <h3>{evidence.label}</h3>
      <div className="evidence-value">
        {format(evidence.value)}
        <span>ориентир {format(evidence.benchmark)}</span>
      </div>
      {!compact && <p>{evidence.note}</p>}
      <div className="evidence-footer">
        <span>{evidence.match_ids.length} матчей</span>
        <button onClick={() => showEvidence(evidence)}>
          Показать доказательства <ArrowUpRight size={13} />
        </button>
      </div>
      {!compact && (
        <button
          className="text-button mt-3"
          disabled={!supportingMatch}
          onClick={() =>
            supportingMatch &&
            go("/matches", {
              selectedMatchId: supportingMatch.match_id,
              selectedOpponentId: supportingMatch.opponent_id,
              isHome: !!supportingMatch.is_home,
              selectedHistoricalMatchContext: null,
              selectedResearchEvidence: evidence,
            })
          }
        >
          Показать матч-доказательство <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}
export function ProbabilityBars({
  value,
  compact = false,
}: {
  value: Probabilities;
  compact?: boolean;
}) {
  const data = [
    { key: "win", label: "Победа", value: value.win },
    { key: "draw", label: "Ничья", value: value.draw },
    { key: "loss", label: "Поражение", value: value.loss },
  ];
  return (
    <div className={`probabilities ${compact ? "compact" : ""}`}>
      <div
        className="probability-track"
        role="img"
        aria-label={data.map((p) => `${p.label}: ${pct(p.value)}`).join(", ")}
      >
        {data.map((p) => (
          <div
            key={p.key}
            className={`prob-${p.key}`}
            style={{ width: `${p.value * 100}%` }}
            title={`${p.label}: ${pct(p.value)}`}
          />
        ))}
      </div>
      <div className="probability-labels">
        {data.map((p) => (
          <div key={p.key}>
            <span>
              <i className={`dot prob-${p.key}`} />
              {p.label}
            </span>
            <strong>{pct(p.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
export function OpponentSelect() {
  const { opponent, clubs, selectedClubId, setOpponent } = useApp();
  return (
    <label className="field">
      Соперник
      <select
        aria-label="Выберите соперника"
        value={opponent?.team_id ?? ""}
        onChange={(e) => setOpponent(Number(e.target.value))}
      >
        {clubs
          .filter((c) => c.team_id !== selectedClubId)
          .map((c) => (
            <option key={c.team_id} value={c.team_id}>
              {clubName(c.name)}
            </option>
          ))}
      </select>
    </label>
  );
}
export function PlanningControls() {
  const { isHome, priority, maxInterventions, priorityStrength, update } =
    useApp();
  return (
    <>
      <label className="field">
        Поле
        <select
          aria-label="Поле"
          value={isHome ? "home" : "away"}
          onChange={(e) =>
            update({
              isHome: e.target.value === "home",
              selectedHistoricalMatchContext: null,
            })
          }
        >
          <option value="home">Дома</option>
          <option value="away">В гостях</option>
        </select>
      </label>
      <label className="field">
        Приоритет
        <select
          aria-label="Приоритет тренера"
          value={priority}
          onChange={(e) =>
            update({ priority: e.target.value as typeof priority })
          }
        >
          <option value="balanced">Баланс</option>
          <option value="attack">Атака</option>
          <option value="defense">Защита</option>
        </select>
      </label>
      <label className="field">
        Ресурс штаба
        <select
          aria-label="Число вмешательств"
          value={maxInterventions}
          onChange={(e) => update({ maxInterventions: Number(e.target.value) })}
        >
          <option value="1">Одно направление</option>
          <option value="2">До двух направлений</option>
        </select>
      </label>
      <label className="field range-field">
        Вес приоритета <b>{pct(priorityStrength, 0)}</b>
        <input
          aria-label="Вес выбранного приоритета"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={priorityStrength}
          onChange={(e) => update({ priorityStrength: Number(e.target.value) })}
        />
      </label>
    </>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button,a[href],input,select,summary,[tabindex="0"]',
          ) ?? [],
        );
        if (event.shiftKey && document.activeElement === nodes[0]) {
          event.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
          event.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="methodology-drawer"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="drawer-top">
          <div className="eyebrow">Научный подход</div>
          <button
            className="icon-button"
            aria-label="Закрыть окно"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </div>
        <h2 id="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
export function Methodology() {
  const { meta, setMethodologyOpen } = useApp();
  if (!meta) return null;
  return (
    <Modal
      title="От данных к решению"
      onClose={() => setMethodologyOpen(false)}
    >
      <p className="muted">Лабораторная работа №2 · Сценарий №4 · Уровень 3</p>
      <div className="method-stages">
        {[
          [
            Search,
            "Проблема",
            "Почему клуб теряет очки? Выбрать одно или два изменения для проверки.",
          ],
          [
            Database,
            "Данные",
            `${meta.coverage.matches} матчей, ${meta.coverage.clubs} клубов, события и составы StatsBomb.`,
          ],
          [
            FlaskConical,
            "Аналитика и AI",
            "Четыре гипотезы, K-Means и три модели исхода.",
          ],
          [
            ShieldCheck,
            "Валидация",
            "Будущая тестовая выборка, сравнение с базой и анализ чувствительности.",
          ],
          [
            Layers3,
            "Решение",
            "Проверяемый эксперимент, его основания, риски и план оценки.",
          ],
        ].map(([Icon, title, text], i) => {
          const I = Icon as typeof Search;
          return (
            <div key={String(title)}>
              <span className="stage-number">0{i + 1}</span>
              <I size={19} />
              <div>
                <h3>{String(title)}</h3>
                <p>{String(text)}</p>
              </div>
            </div>
          );
        })}
      </div>
      <Note warning>
        Исторические данные 2015/16. Модель не прогнозирует современный футбол.
      </Note>
      <Disclosure title="Источник, полнота и очистка">
        <p>
          Источник:{" "}
          <a href={meta.coverage.source_url} target="_blank" rel="noreferrer">
            StatsBomb Open Data ↗
          </a>
        </p>
        <p>
          Матчи со сверенным счётом: {meta.coverage.score_reconciled_matches}.
          Полнота xG ударов: {pct(meta.coverage.shot_xg_completeness)}.
        </p>
        <p className="code-wrap">Ревизия: {meta.coverage.revision}</p>
        {meta.coverage.cleaning_decisions.map((t) => (
          <p key={t}>{t}</p>
        ))}
      </Disclosure>
      <Disclosure title="Как определены показатели">
        {Object.entries(meta.definitions).map(([key, value]) => (
          <p key={key}>
            <b>
              {meta.metric_labels[key] ??
                {
                  central_box: "Центр штрафной",
                  shot_zones: "Зоны ударов",
                  pass_direction: "Направления передач",
                  attack_zone: "Зона атаки",
                  rolling: "Историческая форма",
                  expected_points: "Ожидаемые очки",
                  zero_shots: "Матчи без ударов",
                  conversion: "Реализация",
                  dangerous: "Опасный удар",
                  shots_on_target: "Удар в створ",
                  ball_recoveries: "Возвраты мяча",
                  points_dropped: "Потерянные очки",
                }[key] ??
                "Определение показателя"}
              .
            </b>{" "}
            {value}
          </p>
        ))}
      </Disclosure>
      <Disclosure title="Методологические ловушки" open>
        <p>
          <b>Утечка будущего.</b> Текущие xG и счёт сделали бы оценку
          искусственно точной. ML использует только завершённые матчи до даты
          встречи; кластеры полного сезона в прогноз не входят.
        </p>
        <p>
          <b>Корреляция и причинность.</b> Рост xGA связан с потерей очков, но
          может отражать силу соперника. Снижение xGA ползунком — допущение, а
          не доказанный эффект компактности.
        </p>
        <p>
          <b>Малая выборка.</b> Всего 38 матчей клуба. Случайные пенальти,
          календарь и реализация могут заметно менять выводы.
        </p>
      </Disclosure>
      <p className="attribution">
        Данные и модель xG — StatsBomb. Клубные названия принадлежат их
        правообладателям.
      </p>
    </Modal>
  );
}
