"""Ряды визуализаций: Python рассчитывает, React только рисует."""
from collections import defaultdict
from app.data import clean


def season_visuals(g, other):
    comparisons=[]
    for metric,label in [('xg','Создание моментов'),('shots','Объём ударов'),('shot_quality','Качество удара'),
                         ('pass_accuracy','Точность передач'),('xga','Допущенный xG')]:
        a=float(g[metric].mean()); b=float(other[metric].mean())
        comparisons.append({'metric':metric,'label':label,'team':a,'league':b,'index':a/b*100 if b else None})
    return clean({'league_comparison':comparisons,
        'season_series':[{'match_id':int(r.match_id),'round':int(r.match_week),'date':r.match_date,
            'opponent':r.opponent_name,'goals_for':r.goals_for,'goals_against':r.goals_against,
            'xg':r.xg,'xga':r.xga,'points':r.points,'result':r.result} for r in g.itertuples()],
        'comparison_note':'Среднее клуба / среднее остальных клубов × 100. Уровень 100 — ориентир лиги; для xGA меньшее значение предпочтительнее.'})


def match_visuals(shots, teams, patterns, team_id):
    timeline=[]; totals={r['team_id']:0. for r in teams}; by_minute=defaultdict(list)
    for shot in shots:
        by_minute[shot['minute']].append(shot)
    for minute in sorted({0,max([90]+[s['minute'] for s in shots]),*by_minute.keys()}):
        for shot in by_minute[minute]:
            totals[shot['team_id']]+=shot['xg'] or 0
        timeline.append({'minute':minute,'team_xg':totals[team_id],
                         'opponent_xg':sum(v for k,v in totals.items() if k!=team_id)})
    bins=[]
    for lo,hi in [(0,.05),(.05,.10),(.10,.20),(.20,.40),(.40,1.01)]:
        selected=[s for s in shots if s['xg'] is not None and lo<=s['xg']<hi]
        bins.append({'label':f'{lo:.2f}–{min(1,hi):.2f}'.replace('.',','),'team':sum(s['team_id']==team_id for s in selected),
                     'opponent':sum(s['team_id']!=team_id for s in selected)})
    zones=[]
    for z,label in [('outside_box','Вне штрафной'),('wide_box','Фланги штрафной'),('central_box','Центр штрафной')]:
        sel=[s for s in shots if s['zone']==z]
        zones.append({'zone':z,'label':label,
            'team_shots':sum(s['team_id']==team_id for s in sel),
            'opponent_shots':sum(s['team_id']!=team_id for s in sel),
            'team_xg':sum((s['xg'] or 0) for s in sel if s['team_id']==team_id),
            'opponent_xg':sum((s['xg'] or 0) for s in sel if s['team_id']!=team_id)})
    own=[p for p in patterns if p['team_id']==team_id]; matrix=[]
    for a in range(9):
        for b in range(9):
            p=next((p for p in own if p['start_zone']==a and p['end_zone']==b),None)
            matrix.append({'start_zone':a,'end_zone':b,'attempts':p['attempts'] if p else 0,
                           'completed':p['completed'] if p else 0})
    t=next(t for t in teams if t['team_id']==team_id)
    interpretation=(f'Команда набрала {t["points"]:.0f} очк.; xG {t["xg"]:.2f}, xGA {t["xga"]:.2f}, '
        f'удары {t["shots"]:.0f}:{t["shots_against"]:.0f}. '
        + ('По качеству созданных моментов преимущество было у выбранного клуба. ' if t['xgd']>0 else
           'По качеству созданных моментов преимущество было у соперника. ' if t['xgd']<0 else 'Разница xG равна нулю. ')
        + 'Сравнение помогает выбрать эпизоды для видеоразбора; оно не доказывает причину результата.')
    return clean({'xg_timeline':timeline,'quality_distribution':bins,'attack_zones':zones,
                  'passing_matrix':matrix,'interpretation':interpretation})


def style_visuals(artifact, team_id, opponent_id):
    profiles=artifact['profiles']; features=artifact['features']; points=[]; radar=[]
    lo=profiles.min(); hi=profiles.max(); span=(hi-lo).replace(0,1)
    for tid,row in profiles.iterrows():
        points.append({'team_id':int(tid),'cluster_id':artifact['labels'][int(tid)],
                       'passes':row['passes'],'shots':row['shots'],'profile':row.to_dict()})
    for f in features:
        radar.append({'metric':f,'team':(profiles.loc[team_id,f]-lo[f])/span[f]*100,
            'opponent':(profiles.loc[opponent_id,f]-lo[f])/span[f]*100 if opponent_id else None,
            'league':(profiles[f].mean()-lo[f])/span[f]*100,
            'team_raw':profiles.loc[team_id,f],
            'opponent_raw':profiles.loc[opponent_id,f] if opponent_id else None})
    centers=artifact['scaler'].inverse_transform(artifact['model'].cluster_centers_)
    cluster_comparison=[{'metric':f,'values':{f'group_{i}':(center[j]-lo[f])/span[f]*100
                         for i,center in enumerate(centers)}} for j,f in enumerate(features)]
    return clean({'team_profiles':points,'radar':radar,'cluster_comparison':cluster_comparison,
                  'normalization':'Каждый показатель отдельно приведён к 0..100 по минимуму и максимуму 20 сезонных профилей. Большое значение означает больше показателя, а не лучшее качество.'})
