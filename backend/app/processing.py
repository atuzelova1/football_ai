"""Проверка одного матча и извлечение событийных признаков без хранения сезона в RAM."""
from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from datetime import date

from app.data import SCHEMA_VERSION, put_meta

NUMERIC = ['goals_for','goals_against','points','points_dropped','shots','shots_on_target',
           'shot_goals','own_goals_for','xg','nonpenalty_xg','penalties','xg_available',
           'dangerous','central_shots','passes','completed_passes','progressive_passes',
           'forward_passes','backward_passes','lateral_passes','pass_coordinate_count',
           'pass_positive_dx','pass_length','attack_left','attack_center','attack_right',
           'defensive_events','ball_recoveries','possessions','shots_against','xga',
           'dangerous_against','central_against','central_xga','pass_accuracy','pass_share',
           'directness','shot_quality','conversion','xgd','central_attack_share']


def initialize(conn):
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS clubs(team_id INTEGER PRIMARY KEY,name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS matches(
          match_id INTEGER PRIMARY KEY,match_date TEXT NOT NULL,kick_off TEXT NOT NULL,
          match_week INTEGER NOT NULL,home_id INTEGER REFERENCES clubs(team_id),
          away_id INTEGER REFERENCES clubs(team_id),home_score INTEGER,away_score INTEGER,
          quality TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS shots(
          event_id TEXT PRIMARY KEY,match_id INTEGER REFERENCES matches(match_id),
          team_id INTEGER REFERENCES clubs(team_id),player_id INTEGER,minute INTEGER,
          x REAL,y REAL,xg REAL,outcome TEXT,zone TEXT,penalty INTEGER,goal INTEGER);
        CREATE TABLE IF NOT EXISTS lineups(
          match_id INTEGER REFERENCES matches(match_id),team_id INTEGER REFERENCES clubs(team_id),
          player_id INTEGER,name TEXT,starter INTEGER,positions TEXT,
          PRIMARY KEY(match_id,team_id,player_id));
        CREATE TABLE IF NOT EXISTS pass_patterns(
          match_id INTEGER REFERENCES matches(match_id),team_id INTEGER REFERENCES clubs(team_id),
          start_zone INTEGER,end_zone INTEGER,attempts INTEGER,completed INTEGER,
          PRIMARY KEY(match_id,team_id,start_zone,end_zone));
        CREATE INDEX IF NOT EXISTS shots_team ON shots(team_id,match_id);
    ''')
    cols = ','.join(f'{c} REAL'+('' if c in ('shot_quality','conversion') else ' NOT NULL') for c in NUMERIC)
    conn.execute(f'''CREATE TABLE IF NOT EXISTS team_matches(
        match_id INTEGER REFERENCES matches(match_id),team_id INTEGER REFERENCES clubs(team_id),
        opponent_id INTEGER REFERENCES clubs(team_id),is_home INTEGER,result TEXT,{cols},
        PRIMARY KEY(match_id,team_id))''')
    put_meta(conn, 'schema_version', SCHEMA_VERSION)
    conn.commit()


def valid_location(loc):
    return (isinstance(loc, list) and len(loc) >= 2
            and all(isinstance(v, (int, float)) and math.isfinite(v) for v in loc[:2])
            and 0 <= loc[0] <= 120 and 0 <= loc[1] <= 80)


def zone(loc):
    x, y = loc[:2]
    return 'central_box' if x >= 102 and 18 <= y <= 62 else 'wide_box' if x >= 102 else 'outside_box'


def grid(loc):
    return min(int(loc[0] / 40), 2) * 3 + min(int(loc[1] / (80 / 3)), 2)


def progressive(start, end):
    before = math.hypot(120-start[0], 40-start[1])
    after = math.hypot(120-end[0], 40-end[1])
    return before - after >= 10 and after <= .75 * before


def process_match(conn, match, events, lineups):
    mid = match['match_id']
    assert isinstance(mid, int) and mid > 0, 'Некорректный ID матча'
    date.fromisoformat(match['match_date'])
    assert match['competition']['competition_id'] == 11 and match['season']['season_id'] == 27
    teams = [match[s][s+'_id'] for s in ('home_team', 'away_team')]
    assert len(set(teams)) == 2 and all(isinstance(t, int) and t > 0 for t in teams)
    scores = {teams[0]: match['home_score'], teams[1]: match['away_score']}
    assert all(isinstance(v, int) and v >= 0 for v in scores.values())
    assert len(lineups) == 2 and {l['team_id'] for l in lineups} == set(teams), 'Составы не соответствуют клубам'
    players = {l['team_id']: {p['player_id'] for p in l['lineup']} for l in lineups}
    assert all(len(players[l['team_id']]) == len(l['lineup']) for l in lineups), 'Дубликат игрока'
    assert all(isinstance(p,int) and p>0 for ids in players.values() for p in ids), 'Неверный ID игрока'
    for s in ('home_team', 'away_team'):
        conn.execute('INSERT OR REPLACE INTO clubs VALUES (?,?)', (match[s][s+'_id'], match[s][s+'_name']))
    quality = Counter()
    type_map, pass_outcomes, seen = {}, Counter(), {}
    stats = {t: Counter() for t in teams}
    shot_rows, patterns, possession_ids, own_against, own_for = [], defaultdict(Counter), defaultdict(set), Counter(), Counter()
    event_players = defaultdict(set)
    for e in events:
        eid = e['id']
        assert isinstance(eid, str) and eid, 'Отсутствует ID события'
        if eid in seen:
            assert seen[eid] == e, 'Конфликтующие события с одинаковым ID'
            quality['identical_duplicates_removed'] += 1
            continue
        seen[eid] = e
        typ, tid = e['type']['name'], e['type']['id']
        assert type_map.setdefault(str(tid), typ) == typ, 'Несогласованный тип события'
        t = e.get('team', {}).get('id')
        assert t in teams, 'Событие относится к другому клубу'
        if 'player' in e:
            event_players[t].add(e['player']['id'])
        if typ=='Starting XI':
            starters=e['tactics']['lineup']
            assert len(starters)==11 and {p['player']['id'] for p in starters} <= players[t], 'Неверная стартовая расстановка'
        assert isinstance(e['period'], int) and e['period'] in (1,2,3,4,5)
        assert isinstance(e['minute'], int) and e['minute'] >= 0
        if e['period'] == 5:
            quality['shootout_events_excluded'] += 1
            continue
        s = stats[t]
        quality['events'] += 1
        if 'location' in e and not valid_location(e['location']):
            quality['invalid_event_locations'] += 1
        if e.get('possession_team', {}).get('id') == t:
            possession_ids[t].add(e['possession'])
        if typ == 'Shot':
            sh = e['shot']; xg = sh.get('statsbomb_xg'); loc = e.get('location')
            s['shots'] += 1
            if xg is None:
                quality['missing_shot_xg'] += 1
            else:
                assert isinstance(xg, (int,float)) and math.isfinite(xg) and 0 <= xg <= 1, 'Недопустимый xG'
                s['xg'] += xg; s['xg_available'] += 1
                s['dangerous'] += xg >= .20
            if not valid_location(loc):
                quality['missing_or_invalid_shot_location'] += 1
                loc, z = [None, None], 'unknown'
            else:
                z = zone(loc)
            outcome = sh['outcome']['name']; goal = outcome == 'Goal'
            penalty = sh.get('type', {}).get('name') == 'Penalty'
            s['shot_goals'] += goal; s['penalties'] += penalty
            s['nonpenalty_xg'] += (xg or 0) if not penalty else 0
            s['shots_on_target'] += outcome in ('Goal','Saved','Saved to Post')
            s['central_shots'] += z == 'central_box'
            if z == 'central_box':
                s['central_xg'] += xg or 0
            shot_rows.append((eid,mid,t,e.get('player',{}).get('id'),e['minute'],*loc[:2],xg,outcome,z,int(penalty),int(goal)))
        elif typ == 'Own Goal Against':
            own_against[t] += 1
        elif typ == 'Own Goal For':
            own_for[t] += 1
        elif typ == 'Pass':
            p = e['pass']; s['passes'] += 1
            outcome = p.get('outcome', {}).get('name', 'Complete')
            pass_outcomes[outcome] += 1
            assert outcome in ('Complete','Incomplete','Out','Pass Offside','Unknown','Injury Clearance'), 'Неизвестный исход передачи'
            complete = outcome == 'Complete'; s['completed_passes'] += complete
            start, end = e.get('location'), p.get('end_location')
            if valid_location(start) and valid_location(end):
                dx = end[0]-start[0]
                s['pass_coordinate_count'] += 1
                s['pass_positive_dx'] += max(0, dx)
                s['pass_length'] += math.dist(start[:2], end[:2])
                s['forward_passes'] += dx > 5
                s['backward_passes'] += dx < -5
                s['lateral_passes'] += -5 <= dx <= 5
                s['progressive_passes'] += complete and progressive(start, end)
                if end[0] >= 80:
                    s[['attack_left','attack_center','attack_right'][min(int(end[1]/(80/3)),2)]] += 1
                pat = patterns[(t,grid(start),grid(end))]
                pat['attempts'] += 1; pat['completed'] += complete
            else:
                quality['missing_or_invalid_pass_coordinates'] += 1
        elif typ in ('Duel','Interception','Block','Clearance'):
            s['defensive_events'] += 1
        elif typ == 'Ball Recovery':
            s['ball_recoveries'] += not e.get('ball_recovery', {}).get('recovery_failure', False)
    for t in teams:
        assert event_players[t] <= players[t], f'Игрок события отсутствует в составе: {event_players[t]-players[t]}'
    quality['shots'] = sum(s['shots'] for s in stats.values())
    quality['shots_with_xg'] = sum(s['xg_available'] for s in stats.values())
    quality['passes'] = sum(s['passes'] for s in stats.values())
    quality['own_goal_against_events'] = sum(own_against.values())
    quality['own_goal_for_events'] = sum(own_for.values())
    for i,t in enumerate(teams):
        opp = teams[1-i]
        # Against — каноническая запись автогола; For используется только при её отсутствии.
        og = own_against[opp] if own_against[opp] else own_for[t]
        assert stats[t]['shot_goals'] + og == scores[t], f'Счёт не сходится в матче {mid}: {t}'
        if own_against[opp] and own_for[t]:
            assert own_against[opp] == own_for[t], 'Несогласованные записи автогола'
        s, o = stats[t], stats[opp]
        s.update({'goals_for':scores[t], 'goals_against':scores[opp], 'own_goals_for':og,
                  'points':3 if scores[t]>scores[opp] else 1 if scores[t]==scores[opp] else 0,
                  'shots_against':o['shots'], 'xga':o['xg'], 'dangerous_against':o['dangerous'],
                  'central_against':o['central_shots'], 'central_xga':o['central_xg'],
                  'possessions':len(possession_ids[t])})
        s['points_dropped'] = 3-s['points']; s['xgd'] = s['xg']-s['xga']
        s['pass_accuracy'] = s['completed_passes']/s['passes'] if s['passes'] else 0
        s['pass_share'] = s['passes']/(s['passes']+o['passes']) if s['passes']+o['passes'] else 0
        s['directness'] = s['pass_positive_dx']/s['pass_length'] if s['pass_length'] else 0
        s['shot_quality'] = s['xg']/s['xg_available'] if s['xg_available'] else None
        s['conversion'] = s['shot_goals']/s['shots'] if s['shots'] else None
        attack_total = sum(s[k] for k in ('attack_left','attack_center','attack_right'))
        s['central_attack_share'] = s['attack_center']/attack_total if attack_total else 0
    quality['event_types'] = type_map; quality['pass_outcomes'] = dict(pass_outcomes)
    conn.execute('INSERT INTO matches VALUES (?,?,?,?,?,?,?,?,?)',
                 (mid,match['match_date'],match['kick_off'],match['match_week'],*teams,
                  scores[teams[0]],scores[teams[1]],json.dumps(quality,ensure_ascii=False)))
    for i,t in enumerate(teams):
        s=stats[t]; result = 'W' if s['points']==3 else 'D' if s['points']==1 else 'L'
        values = [mid,t,teams[1-i],int(i==0),result]+[float(s[c]) if s[c] is not None else None for c in NUMERIC]
        assert all(v is None or math.isfinite(v) for v in values[5:]), 'Нечисловой признак'
        conn.execute('INSERT INTO team_matches VALUES ('+','.join('?' for _ in values)+')', values)
    conn.executemany('INSERT INTO shots VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',shot_rows)
    conn.executemany('INSERT INTO pass_patterns VALUES (?,?,?,?,?,?)',
                     [(mid,t,a,b,v['attempts'],v['completed']) for (t,a,b),v in patterns.items()])
    for lineup in lineups:
        for p in lineup['lineup']:
            positions=p.get('positions',[])
            conn.execute('INSERT INTO lineups VALUES (?,?,?,?,?,?)',
                         (mid,lineup['team_id'],p['player_id'],p['player_name'],
                          int(any(v['start_reason']=='Starting XI' for v in positions)),
                          json.dumps(positions,ensure_ascii=False)))
    conn.commit()
    return quality
