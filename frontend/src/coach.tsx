import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, FileText, Printer, Sparkles } from "lucide-react";
import { apiRequest, useApi } from "./api";
import { useApp } from "./context";
import {
  Action,
  Disclosure,
  ErrorState,
  EvidenceCard,
  InfoHint,
  Loading,
  Modal,
  Note,
  Panel,
} from "./components";
import { clubName, date, metricName, metricValue, metricUnit, n, signed } from "./format";
import type { AIAnalysis, CoachingBrief } from "./types";

export function useCoachBody() {
  const ctx = useApp();
  return {
    team_id: ctx.selectedClubId,
    opponent_id: ctx.selectedOpponentId,
    is_home: ctx.isHome,
    priority: ctx.priority,
    max_interventions: ctx.maxInterventions,
    priority_strength: ctx.priorityStrength,
    match_id: ctx.selectedMatchId,
    historical_match_id: ctx.selectedHistoricalMatchContext?.matchId ?? null,
    as_of: ctx.selectedHistoricalMatchContext?.date ?? null,
    scenario: ctx.currentTacticalScenario,
  };
}

export function CoachingBriefButton({
  recommendationId,
  analysis,
}: {
  recommendationId?: string;
  analysis?: AIAnalysis;
}) {
  const body = useCoachBody();
  const key = JSON.stringify(body);
  const [open, setOpen] = useState(false);
  const api = useApi<CoachingBrief>(
    "/api/coaching/brief",
    { ...body, recommendation_id: recommendationId ?? null },
    open,
  );
  useEffect(() => setOpen(false), [key]);
  return (
    <>
      <button className="button-secondary" onClick={() => setOpen(true)}>
        <FileText size={16} />
        Тренерская сводка
      </button>
      {open &&
        createPortal(
          <Modal title="Тренерская сводка" onClose={() => setOpen(false)}>
            {api.error ? (
              <ErrorState error={api.error} retry={api.retry} />
            ) : !api.data ? (
              <Loading />
            ) : (
              <>
                <div className="brief-toolbar no-print">
                  <p>
                    Проверьте сводку перед печатью. Файл создаётся только через
                    диалог браузера.
                  </p>
                  <button
                    className="button-primary"
                    onClick={() => window.print()}
                  >
                    <Printer size={16} />
                    Печать / Сохранить в PDF
                  </button>
                </div>
                <BriefPreview brief={api.data} analysis={analysis} />
              </>
            )}
          </Modal>,
          document.body,
        )}
    </>
  );
}

export function BriefPreview({
  brief: b,
  analysis,
}: {
  brief: CoachingBrief;
  analysis?: AIAnalysis;
}) {
  const a =
    analysis?.team_id === b.team.team_id &&
    analysis.opponent_id === b.opponent?.team_id &&
    JSON.stringify(analysis.baseline) === JSON.stringify(b.baseline) &&
    JSON.stringify(analysis.scenario) === JSON.stringify(b.scenario)
      ? analysis
      : undefined;
  return (
    <article
      className="brief-preview"
      aria-label="Предпросмотр тренерской сводки"
    >
      <header className="brief-heading">
        <div className="brief-brand">
          FOOTBALL AI <span>Тактический интеллект</span>
        </div>
        <p>Историческая тренерская лаборатория · {b.season}</p>
        <h1>
          {clubName(b.team.name)} —{" "}
          {b.opponent ? clubName(b.opponent.name) : "соперник"}
        </h1>
        <p>
          {b.is_home ? "Дома" : "В гостях"} ·{" "}
          {b.as_of
            ? `Сценарная база до ${date(b.as_of)}`
            : "Сезон 2015/16"}
        </p>
      </header>
      <section>
        <h2>Задача штаба</h2>
        <p>{b.recommendation.diagnosed_problem}</p>
      </section>
      <section>
        <h2>Что проверить</h2>
        <h3>{b.recommendation.title}</h3>
        <p>{b.recommendation.experiment}</p>
      </section>
      {a && (
        <section>
          <h2>Дополнительная гипотеза AI</h2>
          <p>{a.analysis.recommendation}</p>
          <p>Модель: {a.model}.</p>
        </section>
      )}
      <section>
        <h2>Допущение и модельный эффект</h2>
        <h3>{b.scenario.title}</h3>
        <p>xG / xGA: {n(b.baseline.attack_xg,2)} / {n(b.baseline.defense_xg,2)} → {n(b.scenario.attack_xg,2)} / {n(b.scenario.defense_xg,2)}.</p>
        <div className="brief-numbers">
          <span>
            База <b>{n(b.baseline.probabilities.expected_points, 3)} очк.</b>
          </span>
          <span>
            Сценарий{" "}
            <b>{n(b.scenario.probabilities.expected_points, 3)} очк.</b>
          </span>
          <span>
            Изменение <b>{signed(b.scenario.delta_expected_points, 3)} очк.</b>
          </span>
        </div>
        <p>
          {Object.entries(b.scenario.assumptions)
            .filter(([, v]) => v !== 0)
            .map(
              ([k, v]) =>
                `${({ shot_volume_change: "Объём ударов", shot_quality_change: "Качество удара", attack_xg_change: "Атакующий xG", xga_reduction: "Снижение xGA" } as Record<string, string>)[k]}: ${signed(v * 100, 0)}%`,
            )
            .join("; ") || "Без изменения параметров"}
          .
        </p>
      </section>
      <section>
        <h2>Основания</h2>
        <table>
          <thead>
            <tr>
              <th>Показатель</th>
              <th>Клуб</th>
              <th>Ориентир сравнения</th>
            </tr>
          </thead>
          <tbody>
            {b.evidence.slice(0, 3).map((e) => (
              <tr key={e.id}>
                <td>
                  {e.label} <small>{metricUnit(e.metric)} · {e.match_ids.length} матчей</small>
                </td>
                <td>{metricValue(e.metric,e.value)}</td>
                <td>{metricValue(e.metric,e.benchmark)}<small>{e.id.includes(":nonwinning:") ? "Победы клуба" : e.metric === "style_xgd" ? "Среднее клуба" : e.id.includes(":simulation:") ? "Лига, то же поле" : "Остальные клубы"}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="brief-match">Для разбора: {date(b.supporting_match.date)}, {clubName(b.supporting_match.opponent.name)}, {b.supporting_match.goals_for}:{b.supporting_match.goals_against} с точки зрения клуба. Целевой пример, не типичный матч.</p>
      </section>
      {!!b.alternatives.length && (
        <section>
          <h2>Альтернативы</h2>
          {b.alternatives.map((v) => (
            <p key={v.title}>
              <b>{v.title}.</b> Модельный прирост:{" "}
              {signed(v.modeled_delta_expected_points, 3)} очк.
            </p>
          ))}
        </section>
      )}
      <section>
        <h2>Риски</h2>
        <ul>
          {b.recommendation.risks.slice(0,2).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <h2>План проверки</h2>
        <ul className="brief-checklist">
          <li>{b.recommendation.evaluation_plan}</li>
          <li>Учесть поле и соперника; сохранить все матчи, включая неудачные.</li>
        </ul>
      </section>
      <section>
        <h2>Границы вывода</h2>
        <p>
          {b.as_of
            ? "Диагностика и база используют только матчи до выбранной даты."
            : "Диагностика полного сезона ретроспективна."}{" "}
          Нет встроенного видео и трекинга. Гипотезу необходимо проверить с
          учётом соперника и контекста.
        </p>
      </section>
      <footer>
        {b.source}
        <br />
        Сводка создана:{" "}
        {new Date(b.created_at).toLocaleString("ru-RU")}
      </footer>
    </article>
  );
}

export function AIWorkspace() {
  const ctx = useApp();
  const body = useCoachBody(),
    key = JSON.stringify(body);
  const keyRef = useRef(key);
  keyRef.current = key;
  const status = useApi<{
    available: boolean;
    model: string | null;
    message: string;
    source_is_current?: boolean;
    integration_version?: string;
  }>("/api/advisor/ai/status");
  const requestController = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState(
    "Какое тактическое изменение стоит проверить и почему?",
  );
  const [state, setState] = useState<{
    key: string;
    data?: AIAnalysis;
    error?: string;
    busy?: boolean;
  }>({ key: "" });
  const [lastQuestion, setLastQuestion] = useState("");
  const current = state.key === key ? state : undefined;
  useEffect(() => {
    setState({ key });
    setQuestion("Какое тактическое изменение стоит проверить и почему?");
    setLastQuestion("");
    return () => requestController.current?.abort();
  }, [key]);
  async function generate() {
    if (current?.busy || question.trim().length < 5) return;
    const requestKey = key;
    const controller = new AbortController();
    requestController.current = controller;
    setState({ key, busy: true, data: current?.data });
    try {
      const data = await apiRequest<AIAnalysis>("/api/advisor/ai", {
        ...body,
        question: question.trim(),
        previous_analysis_id: current?.data?.analysis_id ?? null,
      }, { signal: controller.signal });
      if (keyRef.current === requestKey) {
        setState({ key: requestKey, data });
        setLastQuestion(question);
        setQuestion("");
      }
    } catch (e) {
      if (!controller.signal.aborted && keyRef.current === requestKey)
        setState({
          key: requestKey,
          error: (e as Error).message,
          data: current?.data,
        });
    } finally {
      if (requestController.current === controller) requestController.current = null;
    }
  }
  const out = current?.data;
  const evidence = (ids: string[]) =>
    out?.evidence
      .filter((e) => ids.includes(e.id))
      .map((e) => (
        <button
          key={e.id}
          className="evidence-chip"
          onClick={() => ctx.showEvidence(e)}
        >
          {e.label}
          <ArrowUpRight size={12} />
        </button>
      ));
  return (
    <Panel
      title="Обсудить решение с AI"
      subtitle="Задайте вопрос о команде, сопернике или выбранном плане."
      className="ai-workspace"
    >
      {status.error ? (
        <ErrorState compact error={status.error} retry={status.retry} />
      ) : !status.data ? (
        <Loading compact label="Проверяем настройку AI…" />
      ) : (
        <>
          <div className="ai-status">
            <span
              className={`status-dot ${status.data.available ? "" : "offline"}`}
            />
            <p>{status.data.message}</p>
            <InfoHint label="О подключении внешнего AI" text="Анализ отправляется в OpenAI только по кнопке. Подключение проверяется при запросе; автоматических повторов нет." />
            <button className="text-button" onClick={status.retry}>
              Проверить настройку
            </button>
          </div>
          {status.data.source_is_current === false && <ErrorState compact error="Backend работает со старой версией кода. Перезапустите сервер и проверьте настройку." retry={status.retry} />}
          {!status.data.available && (
            <Disclosure title="Как подключить внешний AI">
              <p>
                Задайте OPENAI_API_KEY в окружении backend и перезапустите
                сервер. OPENAI_MODEL выбирает модель с поддержкой Structured
                Outputs. Ключ вводится только на вашем компьютере, не в
                интерфейсе и не в чате.
              </p>
              <p>
                Кнопка передаёт выбранные исторические данные OpenAI. Без
                подключения доступны все расчёты, эксперименты и сводка.
              </p>
            </Disclosure>
          )}
          <label className="ai-question">
            {out
              ? "Уточняющий вопрос по этому контексту"
              : "Вопрос AI-советнику"}
            <textarea
              aria-label="Вопрос AI-советнику"
              maxLength={1200}
              rows={2}
              value={question}
              placeholder="Например: какой риск у выбранного изменения?"
              onChange={(e) => setQuestion(e.target.value)}
              disabled={current?.busy}
            />
          </label>
          <div className="action-row">
            <button
              className="button-primary"
              onClick={generate}
              disabled={
                !status.data.available ||
                status.data.source_is_current === false ||
                current?.busy ||
                question.trim().length < 5
              }
            >
              <Sparkles size={16} />
              {current?.busy
                ? "AI изучает контекст…"
                : out
                  ? "Задать уточняющий вопрос"
                  : "Проанализировать с AI"}
            </button>
            <small>Без ключей, личных данных и секретов в вопросе.</small>
          </div>
        </>
      )}
      {current?.busy && (
        <p className="ai-progress" role="status">
          Проверяем данные и ожидаем ответ. Можно продолжить работу в других
          разделах.
        </p>
      )}
      {current?.error && (
        <ErrorState compact error={current.error} retry={generate} />
      )}
      {out && (
        <div
          className="generated-analysis"
          role="region"
          aria-label="Ответ внешнего AI"
        >
          <div className="generated-meta">
            <span className="pill pill-blue">Внешний AI · {out.model}</span>
            {out.cached && <span className="pill">Ответ из кэша</span>}
            <CoachingBriefButton analysis={out} />
          </div>
          <p className="compact-context">
            {clubName(out.baseline.team.name)} — {out.baseline.opponent ? clubName(out.baseline.opponent.name) : "соперник"} · {out.baseline.as_of ? `до ${date(out.baseline.as_of)}` : "сезон 2015/16"}
          </p>
          <p className="tiny">Вопрос: {lastQuestion}</p>
          <h3>Главный вывод</h3>
          <p>{out.analysis.main_conclusion}</p>
          <div className="light-surface ai-recommendation">
            <span className="eyebrow">Тактический эксперимент</span>
            <h3>Что нужно проверить</h3>
            <p>{out.analysis.recommendation}</p>
          </div>
          <h3>Почему</h3>
          {out.analysis.why.map((r, i) => (
            <div className="ai-reason" key={i}>
              <p>{r.text}</p>
              <div className="evidence-links">{evidence(r.evidence_ids)}</div>
            </div>
          ))}
          {!!out.analysis.alternatives.length && (
            <>
              <h3>Альтернативы</h3>
              {out.analysis.alternatives.map((r, i) => (
                <div key={i}>
                  <p>{r.text}</p>
                  <div className="evidence-links">
                    {evidence(r.evidence_ids)}
                  </div>
                </div>
              ))}
            </>
          )}
          <div className="ai-modeled" role="region" aria-label="Результат выбранного сценария">
            <h3>Выбранный сценарий: {out.scenario.title}</h3>
            <p>Ожидаемые очки: {n(out.baseline.probabilities.expected_points, 3)} → {n(out.scenario.probabilities.expected_points, 3)} очк. / матч</p>
            <strong>
              Изменение: {signed(out.scenario.delta_expected_points, 3)} очк. / матч
            </strong>
            <p>
              {Object.entries(out.scenario.assumptions).filter(([,v]) => v !== 0)
                .map(([k,v]) => `${metricName[k]}: ${signed(v * 100,0)}%`).join(" · ") || "Параметры базы без изменений"}
            </p>
          </div>
          <div className="grid-two">
            <div>
              <h3>Риски</h3>
              <ul>
                {out.analysis.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>План проверки</h3>
              <ul>
                {out.analysis.evaluation_plan.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
          <Disclosure title="Доказательства и недостающая информация">
            <div className="evidence-grid">
              {out.evidence.map((e) => (
                <EvidenceCard key={e.id} evidence={e} />
              ))}
            </div>
            <h3>Чего не хватает</h3>
            <ul>
              {out.analysis.missing_evidence.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Disclosure>
        </div>
      )}
    </Panel>
  );
}
