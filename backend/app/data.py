"""Единый контракт обработанных данных; при чтении API сеть не используется."""
from __future__ import annotations

import json
import math
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / 'data' / 'football.sqlite'
MODEL_DIR = ROOT / 'models'
REVISION = '4b73468fc5b0f1950f9f66fada70ad3a4f9327cb'
SOURCE = 'https://github.com/hudl/open-data'
SCHEMA_VERSION = 2
RESULT_LABELS = {'W': 'Победа', 'D': 'Ничья', 'L': 'Поражение'}
METRIC_LABELS = {
    'xg': 'Ожидаемые голы (xG)', 'xga': 'Допущенные ожидаемые голы (xGA)',
    'xgd': 'Разница xG', 'shots': 'Удары', 'shots_against': 'Допущенные удары',
    'shot_quality': 'Средний xG удара', 'pass_accuracy': 'Точность передач',
    'pass_share': 'Доля передач в матче', 'progressive_passes': 'Прогрессивные передачи',
    'dangerous_against': 'Допущенные опасные удары', 'goals_for': 'Забитые голы',
    'goals_against': 'Пропущенные голы', 'points': 'Очки', 'passes': 'Передачи',
    'directness': 'Направленность передач вперёд', 'defensive_events': 'Защитные события',
    'central_attack_share': 'Доля передач в центральную зону атаки',
}
LIMITATIONS = [
    'Исторический сезон 2015/2016; выводы не описывают нынешние составы и форму.',
    'Связи наблюдательные: корреляция и различие групп не доказывают причинность.',
    'У клуба 38 матчей; отдельные подгруппы малы, оценки неустойчивы.',
    'Доля передач — событийный прокси контроля мяча, а не измеренное время владения.',
    'Нет трекинга: дистанция, скорость, компактность и интенсивность прессинга не измерены.',
]
DEFINITIONS = {
    'xg': 'Сумма shot.statsbomb_xg; пенальти включены, автоголы не имеют xG удара.',
    'xga': 'Сумма xG ударов соперника в том же матче.',
    'shot_quality': 'В матче: xG / число ударов с xG. Итог сезона: сумма xG / сумма ударов. В сравнениях исходов и профилях — невзвешенное среднее матчевых значений.',
    'pass_accuracy': 'Завершённые передачи / все попытки. Исход Unknown сохранён в данных, но не засчитывается завершённым; это может занижать точность.',
    'shots_on_target': 'Исход удара: Goal, Saved либо Saved to Post; Saved Off Target исключён.',
    'conversion': 'Голы из ударов / удары; автоголы исключены из числителя.',
    'dangerous': 'Удар с StatsBomb xG >= 0.20; порог операционный, не тактическая истина.',
    'central_box': 'Начало удара x >= 102, 18 <= y <= 62 на поле StatsBomb 120 × 80.',
    'shot_zones': 'Центр штрафной; фланги штрафной (x>=102); вне штрафной. Координаты ориентированы по атаке бьющей команды.',
    'progressive_passes': 'Завершённая передача, сокращающая евклидово расстояние до (120,40) минимум на 25% и на 10 единиц поля.',
    'pass_direction': 'Вперёд: dx>5; назад: dx<-5; поперёк: остальные передачи.',
    'directness': 'Сумма положительных dx / сумма длины всех передач с валидными координатами; 0..1.',
    'attack_zone': 'Конечная точка передачи x>=80: левый y<80/3, центральный 80/3..160/3, правый y>160/3 коридор.',
    'pass_share': 'Передачи команды / передачи обеих команд; не время владения.',
    'defensive_events': 'Сумма Duel, Interception, Block, Clearance; это число событий, не качество защиты.',
    'ball_recoveries': 'Число событий Ball Recovery без recovery_failure.',
    'points_dropped': '3 минус фактически набранные очки в каждом матче.',
    'rolling': 'Среднее последних пяти строго более ранних матчей; текущий матч исключён; для прогноза минимум три матча.',
    'zero_shots': 'При нуле ударов средний xG удара и конверсия не определены (null); они не подменяются нулём.',
    'expected_points': '3P(победа)+P(ничья) из независимых Пуассонов с параметрами xG и xGA; описательная модель, не официальный xPts.',
}


def clean(value):
    """Строгий JSON без NaN, с числами Python вместо numpy."""
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [clean(v) for v in value]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


@contextmanager
def connection(path=DB_PATH, *, readonly=True):
    if readonly:
        if not Path(path).is_file():
            raise FileNotFoundError('Данные не подготовлены. Выполните python scripts/prepare_data.py из backend.')
        conn = sqlite3.connect(f'file:{Path(path).as_posix()}?mode=ro', uri=True)
    else:
        conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    try:
        yield conn
    finally:
        conn.close()


def query(sql, params=()):
    with connection() as conn:
        return [dict(r) for r in conn.execute(sql, params)]


def frame():
    with connection() as conn:
        return pd.read_sql_query('''SELECT t.*, m.match_date, m.kick_off, m.match_week,
            c.name team_name, o.name opponent_name FROM team_matches t
            JOIN matches m USING(match_id) JOIN clubs c ON c.team_id=t.team_id
            JOIN clubs o ON o.team_id=t.opponent_id
            ORDER BY m.match_date,m.kick_off,t.match_id,t.team_id''', conn)


def club(team_id):
    rows = query('SELECT * FROM clubs WHERE team_id=?', (team_id,))
    if not rows:
        raise ValueError('Клуб с таким StatsBomb ID не найден.')
    return rows[0]


def get_meta(key):
    rows = query('SELECT value FROM metadata WHERE key=?', (key,))
    if not rows:
        raise ValueError('Подготовка данных или моделей не завершена: ' + key)
    return json.loads(rows[0]['value'])


def put_meta(conn, key, value):
    conn.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)',
                 (key, json.dumps(clean(value), ensure_ascii=False, allow_nan=False)))


def evidence(team_id, metric, value, benchmark, match_ids, note, *, suffix='season'):
    return clean({'id': f'team:{team_id}:{suffix}:{metric}', 'team_id': team_id,
                  'metric': metric, 'label': METRIC_LABELS.get(metric, metric),
                  'value': value, 'benchmark': benchmark,
                  'match_ids': sorted(set(int(m) for m in match_ids)),
                  'kind': 'Наблюдаемые данные', 'note': note})
