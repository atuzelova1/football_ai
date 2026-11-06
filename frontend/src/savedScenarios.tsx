import { useEffect, useState } from "react";
import { useApp } from "./context";
import { clubName } from "./format";
import { Disclosure, Empty } from "./components";
import type { SavedScenario, TacticalScenario } from "./types";

const STORAGE = "football-ai:scenarios:v1";
const params = [
  "shot_volume_change",
  "shot_quality_change",
  "attack_xg_change",
  "xga_reduction",
] as const;
export function validSaved(value: unknown): value is SavedScenario {
  if (!value || typeof value !== "object") return false;
  const v = value as SavedScenario,
    s = v.scenario;
  const id = (n: unknown) => Number.isSafeInteger(n) && Number(n) > 0;
  if (
    typeof v.storageId !== "string" ||
    v.storageId.length > 80 ||
    typeof v.name !== "string" ||
    !v.name.trim() ||
    v.name.length > 60 ||
    !id(v.clubId) ||
    !id(v.opponentId) ||
    v.clubId === v.opponentId ||
    typeof v.savedAt !== "string" ||
    !Number.isFinite(Date.parse(v.savedAt)) ||
    typeof v.isHome !== "boolean"
  )
    return false;
  if (v.matchId !== null && !id(v.matchId)) return false;
  if (
    !s ||
    typeof s.title !== "string" ||
    s.title.length > 160 ||
    !["creation", "quality", "defense", "combined", "custom"].includes(s.id) ||
    params.some((k) => !Number.isFinite(s[k]) || Math.abs(s[k]) > 0.5) ||
    (!!s.attack_xg_change &&
      (!!s.shot_volume_change || !!s.shot_quality_change))
  )
    return false;
  if (
    !["balanced", "attack", "defense"].includes(v.priority) ||
    ![1, 2].includes(v.maxInterventions) ||
    !Number.isFinite(v.priorityStrength) ||
    v.priorityStrength < 0 ||
    v.priorityStrength > 1
  )
    return false;
  const h = v.historicalContext;
  return (
    h === null ||
    (!!h &&
      h.teamId === v.clubId &&
      h.opponentId === v.opponentId &&
      h.matchId === v.matchId &&
      h.isHome === v.isHome &&
      typeof h.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(h.date) &&
      Number.isFinite(Date.parse(h.date)))
  );
}
function read(): SavedScenario[] {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE) ?? "[]");
    return Array.isArray(data) ? data.filter(validSaved).slice(0, 20) : [];
  } catch {
    return [];
  }
}
export function SavedScenarios({
  scenario,
  onCompare,
}: {
  scenario: TacticalScenario;
  onCompare: (scenario: TacticalScenario | null) => void;
}) {
  const ctx = useApp();
  const [saved, setSaved] = useState(read),
    [name, setName] = useState(""),
    [notice, setNotice] = useState("");
  const selectionKey = JSON.stringify([
    ctx.selectedClubId,
    ctx.selectedOpponentId,
    ctx.selectedMatchId,
    ctx.isHome,
    ctx.selectedHistoricalMatchContext,
  ]);
  useEffect(() => {
    onCompare(null);
    setNotice("");
  }, [selectionKey]);
  useEffect(() => {
    const listener = () => setSaved(read());
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, []);
  function persist(next: SavedScenario[]) {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(next));
      setSaved(next);
      return true;
    } catch {
      setNotice(
        "Не удалось сохранить: браузер запретил запись или память заполнена.",
      );
      return false;
    }
  }
  function save() {
    if (!name.trim() || !ctx.selectedClubId || !ctx.selectedOpponentId) return;
    const value: SavedScenario = {
      storageId: crypto.randomUUID(),
      name: name.trim(),
      savedAt: new Date().toISOString(),
      clubId: ctx.selectedClubId,
      opponentId: ctx.selectedOpponentId,
      matchId: ctx.selectedMatchId,
      historicalContext: ctx.selectedHistoricalMatchContext,
      isHome: ctx.isHome,
      scenario: { ...scenario },
      priority: ctx.priority,
      maxInterventions: ctx.maxInterventions,
      priorityStrength: ctx.priorityStrength,
    };
    if (!validSaved(value)) {
      setNotice("Параметры сценария некорректны.");
      return;
    }
    if (saved.length >= 20) {
      setNotice(
        "Можно хранить до двадцати сценариев. Удалите ненужный вариант.",
      );
      return;
    }
    if (persist([value, ...saved])) {
      setName("");
      setNotice("Сценарий сохранён на этом компьютере.");
    }
  }
  function reopen(s: SavedScenario) {
    if (
      !ctx.clubs.some((c) => c.team_id === s.clubId) ||
      !ctx.clubs.some((c) => c.team_id === s.opponentId)
    ) {
      setNotice("Клуб из сохранённого варианта недоступен.");
      return;
    }
    ctx.go("/simulator", {
      selectedClubId: s.clubId,
      selectedOpponentId: s.opponentId,
      selectedMatchId: s.matchId,
      selectedHistoricalMatchContext: s.historicalContext,
      isHome: s.isHome,
      currentTacticalScenario: { ...s.scenario },
      selectedResearchEvidence: null,
      priority: s.priority,
      maxInterventions: s.maxInterventions,
      priorityStrength: s.priorityStrength,
    });
    setNotice(`Открыт сценарий «${s.name}».`);
  }
  const own = saved.filter((s) => s.clubId === ctx.selectedClubId);
  return (
    <Disclosure title={`Сохранённые сценарии · ${own.length}`}>
      <p className="small muted">
        Хранятся только параметры в этом браузере. Ключи API и ответы AI сюда не
        записываются.
      </p>
      <div className="save-scenario-row">
        <label className="field">
          Название сценария
          <input
            aria-label="Название сохраняемого сценария"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: защита центра"
          />
        </label>
        <button
          className="button-secondary"
          disabled={!name.trim()}
          onClick={save}
        >
          Сохранить сценарий
        </button>
      </div>
      {notice && (
        <p role="status" className="saved-notice">
          {notice}
        </p>
      )}
      {!own.length ? (
        <Empty title="Сохранённых сценариев пока нет">
          Назовите текущий вариант и сохраните его для сравнения.
        </Empty>
      ) : (
        <div className="saved-list">
          {own.map((s) => {
            const compatible =
              s.opponentId === ctx.selectedOpponentId &&
              s.isHome === ctx.isHome &&
              s.matchId === ctx.selectedMatchId &&
              s.historicalContext?.date ===
                ctx.selectedHistoricalMatchContext?.date;
            return (
              <article key={s.storageId}>
                <div>
                  <h3>{s.name}</h3>
                  <p>
                    {clubName(
                      ctx.clubs.find((c) => c.team_id === s.opponentId)?.name ??
                        "Клуб",
                    )}{" "}
                    · {s.isHome ? "дома" : "в гостях"} ·{" "}
                    {s.historicalContext?.date ?? "полный сезон"}
                  </p>
                  <small>
                    {new Date(s.savedAt).toLocaleString("ru-RU")} ·{" "}
                    {s.scenario.title}
                  </small>
                </div>
                <div className="action-row">
                  <button className="text-button" onClick={() => reopen(s)}>
                    Открыть
                  </button>
                  <button
                    className="text-button"
                    disabled={!compatible}
                    title={
                      compatible
                        ? "Расчёт на той же базе"
                        : "Для сравнения должны совпадать команды, поле и исторический контекст"
                    }
                    onClick={() => {
                      onCompare({
                        ...s.scenario,
                        id: "saved",
                        title: `Сохранённый: ${s.name}`,
                      });
                      setNotice(`Сравниваем с «${s.name}».`);
                    }}
                  >
                    Сравнить с текущим
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      if (
                        persist(
                          saved.filter((v) => v.storageId !== s.storageId),
                        )
                      ) {
                        onCompare(null);
                        setNotice("Сценарий удалён.");
                      }
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <button
        className="text-button"
        onClick={() => {
          onCompare(null);
          setNotice("Сравнение с сохранённым вариантом снято.");
        }}
      >
        Снять сравнение
      </button>
    </Disclosure>
  );
}
