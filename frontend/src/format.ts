export const n = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("ru-RU", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
export const pct = (value: number | null | undefined, digits = 1) =>
  value == null ? "—" : `${n(value * 100, digits)}%`;
export const signed = (value: number, digits = 2) =>
  `${value > 0 ? "+" : ""}${n(value, digits)}`;
export const date = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const names: Record<string, string> = {
  "Athletic Club": "Атлетик Бильбао",
  "Atlético Madrid": "Атлетико Мадрид",
  Barcelona: "Барселона",
  "Celta Vigo": "Сельта",
  Eibar: "Эйбар",
  Espanyol: "Эспаньол",
  Getafe: "Хетафе",
  Granada: "Гранада",
  "Las Palmas": "Лас-Пальмас",
  "Levante UD": "Леванте",
  Málaga: "Малага",
  "RC Deportivo La Coruña": "Депортиво",
  "Rayo Vallecano": "Райо Вальекано",
  "Real Betis": "Бетис",
  "Real Madrid": "Реал Мадрид",
  "Real Sociedad": "Реал Сосьедад",
  Sevilla: "Севилья",
  "Sporting Gijón": "Спортинг Хихон",
  Valencia: "Валенсия",
  Villarreal: "Вильярреал",
};
export const clubName = (name: string) => names[name] ?? name;
export const resultName = (result: string) =>
  ({ W: "Победа", D: "Ничья", L: "Поражение" })[result] ?? result;
export const resultShort = (result: string) =>
  ({ W: "В", D: "Н", L: "П" })[result] ?? result;
export const metricName: Record<string, string> = {
  passes: "Передачи",
  directness: "Игра вперёд",
  pass_accuracy: "Точность",
  shots: "Удары",
  shot_quality: "Качество удара",
  defensive_events: "Защитные события",
  central_attack_share: "Центр атаки",
  diagnostic: "Диагностика",
  modeled_gain: "Эффект модели",
  sample_support: "Выборка",
  priority_alignment: "Приоритет",
  shot_volume_change: "Объём ударов",
  shot_quality_change: "Качество ударов",
  attack_xg_change: "Атакующий xG",
  xga_reduction: "Снижение xGA",
};
