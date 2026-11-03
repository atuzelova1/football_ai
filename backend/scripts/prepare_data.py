"""Из backend: python scripts/prepare_data.py. Кэш привязан к SHA источника."""
from __future__ import annotations

import argparse
import gzip
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from collections import Counter

os.environ.setdefault('LOKY_MAX_CPU_COUNT','2')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.data import ROOT, DB_PATH, REVISION, SCHEMA_VERSION, SOURCE, put_meta
from app.processing import initialize, process_match

CACHE = ROOT / 'data' / 'cache' / REVISION


def fetch(path):
    dest = CACHE / (path+'.gz')
    if dest.exists():
        try:
            return json.loads(gzip.decompress(dest.read_bytes()))
        except (OSError, ValueError):
            dest.unlink()
    url = f'https://raw.githubusercontent.com/hudl/open-data/{REVISION}/data/{path}'
    for attempt in range(5):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Football-AI-University-Research/1.0'})
            with urllib.request.urlopen(req, timeout=90) as response:
                raw=response.read()
            obj=json.loads(raw)
            assert isinstance(obj,list) and obj, 'Пустой или неверный файл источника'
            dest.parent.mkdir(parents=True,exist_ok=True)
            temp=dest.with_suffix('.tmp')
            temp.write_bytes(gzip.compress(raw,compresslevel=1,mtime=0)); temp.replace(dest)
            return obj
        except (OSError, ValueError, AssertionError) as exc:
            if attempt==4:
                raise RuntimeError(f'Не удалось загрузить {path}: {exc}') from exc
            print(f'Повтор {attempt+1}/4: {path} ({type(exc).__name__})',flush=True)
            time.sleep(min(2**attempt,8))


def download_match(match):
    mid=match['match_id']
    # Результат не содержит весь JSON: максимум workers матчей в оперативной памяти.
    fetch(f'events/{mid}.json'); fetch(f'lineups/{mid}.json')
    return mid


def main():
    if hasattr(sys.stdout,'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(description='Подготовка StatsBomb La Liga 2015/2016')
    parser.add_argument('--workers',type=int,default=6)
    parser.add_argument('--rebuild',action='store_true',help='Пересобрать SQLite из кэша')
    args=parser.parse_args()
    ROOT.joinpath('data').mkdir(exist_ok=True); ROOT.joinpath('models').mkdir(exist_ok=True)
    competitions=fetch('competitions.json')
    selected=[c for c in competitions if c['competition_id']==11 and c['season_id']==27]
    assert len(selected)==1 and selected[0]['season_name']=='2015/2016' and selected[0]['competition_name']=='La Liga'
    matches=fetch('matches/11/27.json')
    assert len({m['match_id'] for m in matches})==len(matches), 'Дубликаты матчей'
    teams={m[s][s+'_id'] for m in matches for s in ('home_team','away_team')}
    assert len(matches)==380 and len(teams)==20, 'Неожиданное покрытие закреплённого сезона'
    counts=Counter(t for m in matches for t in (m['home_team']['home_team_id'],m['away_team']['away_team_id']))
    assert set(counts.values())=={38}, 'Неполный календарь'
    print(f'Источник проверен: {len(matches)} матчей, {len(teams)} клубов; SHA {REVISION}',flush=True)
    if args.rebuild and DB_PATH.exists():
        DB_PATH.unlink()
    conn=sqlite3.connect(DB_PATH); conn.execute('PRAGMA foreign_keys=ON')
    if conn.execute("SELECT name FROM sqlite_master WHERE name='metadata'").fetchone():
        row=conn.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()
        assert row and json.loads(row[0])==SCHEMA_VERSION, 'Изменилась схема: используйте --rebuild'
    initialize(conn)
    existing={r[0] for r in conn.execute('SELECT match_id FROM matches')}
    pending=[m for m in sorted(matches,key=lambda m:(m['match_date'],m['kick_off'],m['match_id'])) if m['match_id'] not in existing]
    # Ограниченное окно загрузки: executor.map на всём сезоне удерживал бы завершённые JSON.
    with ThreadPoolExecutor(max_workers=max(1,min(args.workers,12))) as pool:
        for offset in range(0,len(pending),max(1,args.workers)):
            batch=pending[offset:offset+max(1,args.workers)]
            list(pool.map(download_match,batch))
            for m in batch:
                mid=m['match_id']
                q=process_match(conn,m,fetch(f'events/{mid}.json'),fetch(f'lineups/{mid}.json'))
                print(f'Обработано {len(existing)+offset+batch.index(m)+1}/{len(matches)}: {mid}; событий {q["events"]}',flush=True)
    assert conn.execute('SELECT COUNT(*) FROM matches').fetchone()[0]==len(matches)
    totals=Counter(); types={}; outcomes=Counter()
    for (raw,) in conn.execute('SELECT quality FROM matches'):
        q=json.loads(raw)
        for event_id,name in q.pop('event_types').items():
            assert types.setdefault(event_id,name)==name, 'ID типа события несогласован между матчами'
        outcomes.update(q.pop('pass_outcomes')); totals.update(q)
    coverage={'source':'StatsBomb Open Data','source_url':SOURCE,'revision':REVISION,
              'competition':selected[0],'matches':len(matches),'clubs':len(teams),
              'team_matches':len(matches)*2,'matches_per_club':38,
              'events_and_lineups_matches':len(matches),'score_reconciled_matches':len(matches),
              'shot_xg_completeness':totals['shots_with_xg']/totals['shots'],
              'quality_counts':dict(totals),'event_types':types,'pass_outcomes':dict(outcomes),
              'cleaning_decisions':[
                  'ID и составы проверены; конфликтующие дубликаты останавливают подготовку.',
                  'Точные дубликаты событий удаляются; редкие реальные события сохраняются.',
                  'Автогол учитывается один раз по Own Goal Against, с резервом Own Goal For.',
                  'Счёт каждого матча согласован с голами из ударов и автоголами.',
                  'Пенальти включены в xG; отдельно сохранены непенальтийный xG и число пенальти.',
                  'Отсутствующие координаты не восстанавливаются; соответствующие зоны исключаются.',
                  'Все исходные файлы закэшированы с привязкой к SHA; API читает только SQLite и joblib.',
              ]}
    put_meta(conn,'coverage',coverage); conn.commit(); conn.close()
    from app.opponents import train_styles
    from app.prediction import train_models
    from app.analytics import prepare_research
    print('Кластеризация соперников...',flush=True); train_styles()
    print('Хронологическое обучение и проверка моделей...',flush=True); train_models()
    print('Расчёт исследований для всех клубов...',flush=True); prepare_research()
    print('Готово. Данные, исследования и модели доступны без сети.',flush=True)


if __name__=='__main__':
    main()
