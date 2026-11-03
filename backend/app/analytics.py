"""Исследования клуба: воспроизводимые сравнения, тесты и связанное свидетельство."""
from __future__ import annotations

import json
import numpy as np
import pandas as pd
from scipy import stats

from app.data import (frame,query,club,clean,connection,put_meta,get_meta,evidence,
                      METRIC_LABELS,RESULT_LABELS,LIMITATIONS)
from app.simulator import goal_probabilities
from app.visuals import season_visuals, match_visuals


def aggregate(g):
    n=len(g)
    return clean({'matches':n,'wins':int((g.result=='W').sum()),'draws':int((g.result=='D').sum()),
        'losses':int((g.result=='L').sum()),'points':int(g.points.sum()),'points_dropped':int(g.points_dropped.sum()),
        'goals_for':int(g.goals_for.sum()),'goals_against':int(g.goals_against.sum()),
        'xg':g.xg.sum(),'xga':g.xga.sum(),'xgd':g.xgd.sum(),'shots':int(g.shots.sum()),
        'shots_on_target':int(g.shots_on_target.sum()),'shots_against':int(g.shots_against.sum()),
        'shot_quality':g.xg.sum()/g.xg_available.sum() if g.xg_available.sum() else None,
        'conversion':g.shot_goals.sum()/g.shots.sum() if g.shots.sum() else None,
        'pass_accuracy':g.completed_passes.sum()/g.passes.sum() if g.passes.sum() else None,
        'passes':int(g.passes.sum()),'progressive_passes':int(g.progressive_passes.sum()),
        'ball_recoveries':int(g.ball_recoveries.sum()),'defensive_events':int(g.defensive_events.sum()),
        'dangerous':int(g.dangerous.sum()),'dangerous_against':int(g.dangerous_against.sum()),
        'per_match':{k:float(g[k].mean()) if n else None for k in
                     ['points','xg','xga','shots','shots_against','pass_share','directness','dangerous_against']}})


def team_matches(team_id):
    club(team_id); df=frame(); g=df[df.team_id==team_id].copy()
    g['result_label']=g.result.map(RESULT_LABELS)
    return clean(g.to_dict('records'))


def overview(team_id):
    df=frame(); g=df[df.team_id==team_id].copy(); selected=club(team_id)
    league=[]
    for tid,group in df.groupby('team_id'):
        a=aggregate(group)
        league.append({'team_id':int(tid),'name':group.team_name.iloc[0],**{k:a[k] for k in
            ('matches','wins','draws','losses','points','goals_for','goals_against','xg','xga')},
                       'goal_difference':int(group.goals_for.sum()-group.goals_against.sum())})
    league.sort(key=lambda r:(-r['points'],-r['goal_difference'],-r['goals_for'],r['team_id']))
    for i,r in enumerate(league):
        r['position']=i+1
    rolling=[]
    for i,row in enumerate(g.itertuples()):
        window=g.iloc[max(0,i-4):i+1]
        rolling.append({'match_id':int(row.match_id),'match_date':row.match_date,
                        'window_matches':len(window),**{k:window[k].mean() for k in ['xg','xga','xgd','points']}})
    return clean({'team':selected,'season':'2015/2016','summary':aggregate(g),
        'visuals':season_visuals(g,df[df.team_id!=team_id]),
        'home_away':[{'label':'Дома' if h else 'В гостях','is_home':bool(h),'summary':aggregate(g[g.is_home==h])} for h in (1,0)],
        'recent_form':g.tail(5).assign(result_label=lambda x:x.result.map(RESULT_LABELS)).to_dict('records'),
        'rolling':rolling,'rolling_note':'Ретроспективное среднее до указанного матча включительно; для ML используется отдельная строго предматчевая история.',
        'league_table':league,'table_note':'Сортировка по очкам, разнице голов и голам; официальные дополнительные правила личных встреч не воспроизводятся.',
        'problem':{'user':'Тренерский штаб','question':'Почему команда теряет очки и какое тактическое изменение проверить?',
                   'points_dropped':int(g.points_dropped.sum()),'decision':'Выбрать один или два проверяемых тактических эксперимента.'}})


def interval_means(a,b,rng,paired=False,n=1500):
    if paired:
        d=a-b; vals=d[rng.integers(0,len(d),(n,len(d)))].mean(axis=1)
    else:
        vals=a[rng.integers(0,len(a),(n,len(a)))].mean(axis=1)-b[rng.integers(0,len(b),(n,len(b)))].mean(axis=1)
    return np.quantile(vals,[.025,.975]).tolist()


def mean_test(id,question,h0,h1,a,b,seed,paired=False):
    a=np.array(a,float); b=np.array(b,float); rng=np.random.default_rng(seed)
    out={'id':id,'question':question,'h0':h0,'h1':h1,'sample_size':{'group_a':len(a),'group_b':len(b)},
         'method':'Парный перестановочный тест среднего по соперникам' if paired else 'Двусторонний перестановочный тест разницы средних',
         'limitations':['Наблюдательные данные; результат не доказывает причину.',
                         'Матчи зависимы через календарь, состояние команды и состав; обменность приближённая.',
                         '95% процентильный бутстрэп-интервал; он не скорректирован на множественные проверки.']}
    if min(len(a),len(b))<3:
        return {**out,'statistic':None,'p_value':None,'effect_size':None,'confidence_interval':None,
                'interpretation':'Недостаточно наблюдений: необходимо минимум три в каждой группе.'}
    diff=float(a.mean()-b.mean())
    if paired:
        d=a-b
        null=(rng.choice([-1,1],size=(4999,len(d)))*d).mean(axis=1)
        scale=float(np.std(d,ddof=1)); effect=diff/scale if scale else None
        effect_name='Стандартизованная парная разница dz'
    else:
        merged=np.r_[a,b]; null=[]
        for _ in range(4999):
            perm=rng.permutation(merged); null.append(perm[:len(a)].mean()-perm[len(a):].mean())
        null=np.array(null)
        pooled=np.sqrt(((len(a)-1)*a.var(ddof=1)+(len(b)-1)*b.var(ddof=1))/(len(a)+len(b)-2))
        effect=(diff/pooled)*(1-3/(4*(len(a)+len(b))-9)) if pooled else None
        effect_name='Поправленная стандартизованная разница Hedges g'
    p=(np.sum(np.abs(null)>=abs(diff)-1e-14)+1)/(len(null)+1)
    ci=interval_means(a,b,rng,paired)
    return {**out,'statistic':diff,'p_value':float(p),'effect_size':{'name':effect_name,'value':effect},
            'confidence_interval':{'level':.95,'method':'Бутстрэп 1500 повторов','lower':ci[0],
                                   'upper':ci[1]},
            'interpretation':'Разница средних: '+f'{diff:.3f}'+'. Требуется оценить p после поправки Holm; причинность не установлена.'}


def hypotheses(g):
    team_id=int(g.team_id.iloc[0]); wins=g[g.result=='W']; losses=g[g.result=='L']
    prefix=f'team:{team_id}:test:'
    tests=[mean_test(prefix+'xgd_result','Различается ли xG-разница в победах и поражениях?',
        'Средняя xG-разница одинакова.','Средняя xG-разница различается.',wins.xgd,losses.xgd,team_id),
        mean_test(prefix+'quality_result','Различается ли среднее качество удара в победах и поражениях?',
        'Средний xG удара одинаков.','Средний xG удара различается.',
        wins[wins.shots>0].shot_quality,losses[losses.shots>0].shot_quality,team_id+1)]
    # Домашний и гостевой матч спарены по одному и тому же сопернику.
    pairs=g.pivot(index='opponent_id',columns='is_home',values='xgd').dropna()
    tests.append(mean_test(prefix+'home_away','Отличается ли xG-разница дома и в гостях против тех же соперников?',
        'Средняя парная разница равна нулю.','Средняя парная разница отлична от нуля.',pairs[1],pairs[0],team_id+2,True))
    x=g.xga.to_numpy(); y=g.points_dropped.to_numpy(); rng=np.random.default_rng(team_id+3)
    rho=float(stats.spearmanr(x,y).statistic)
    rx=stats.rankdata(x); ry=stats.rankdata(y); rx-=rx.mean(); ry-=ry.mean()
    null=np.array([np.dot(rx,rng.permutation(ry))/(np.linalg.norm(rx)*np.linalg.norm(ry)) for _ in range(4999)])
    p=float((np.sum(np.abs(null)>=abs(rho)-1e-14)+1)/5000)
    boots=[]
    for _ in range(1000):
        idx=rng.integers(0,len(x),len(x))
        if np.ptp(x[idx]) and np.ptp(y[idx]):
            boots.append(stats.spearmanr(x[idx],y[idx]).statistic)
    ci=np.quantile(boots,[.025,.975])
    tests.append({'id':prefix+'xga_dropped','question':'Связан ли допущенный xG с потерей очков?',
        'h0':'Ранговая связь отсутствует.','h1':'Ранговая связь отлична от нуля.',
        'method':'Корреляция Спирмена с двусторонним перестановочным тестом, 4999 перестановок',
        'sample_size':{'matches':len(g)},'statistic':rho,'p_value':p,
        'effect_size':{'name':'Ранговая корреляция Спирмена','value':rho},
        'confidence_interval':{'level':.95,'method':'Парный бутстрэп 1000 повторов','lower':ci[0],'upper':ci[1]},
        'interpretation':f'Ранговая связь xGA и потерянных очков: {rho:.3f}; это связь, не причинный эффект.',
        'limitations':['Матчи зависимы во времени; обменность приближённая.','Очки — дискретный результат с множеством совпадающих рангов.',
                        'Интервал не скорректирован на множественные проверки.']})
    valid=sorted([t for t in tests if t['p_value'] is not None],key=lambda t:t['p_value']); prev=0
    for i,t in enumerate(valid):
        adjusted=min(1,max(prev,t['p_value']*(len(valid)-i))); prev=adjusted
        t['p_adjusted']=adjusted; t['significant']=adjusted<.05
        t['interpretation']+=' '+('Различие/связь значимо на уровне 0.05 после Holm.' if t['significant'] else 'Оснований для значимости после Holm недостаточно.')
    for t in tests:
        t.setdefault('p_adjusted',None); t.setdefault('significant',False)
        t['correction']='Holm для четырёх тестов выбранного клуба; межклубовые сравнения остаются разведочными.'
        t['match_ids']=g.match_id.astype(int).tolist()
    return clean(tests)


def zones(team_id):
    rows=query('''SELECT s.zone,COUNT(*) shots,SUM(s.xg) xg,SUM(s.goal) goals,
        SUM(CASE WHEN s.xg>=0.2 THEN 1 ELSE 0 END) dangerous,
        CASE WHEN s.team_id=? THEN 'for' ELSE 'against' END perspective
        FROM shots s JOIN team_matches t ON t.match_id=s.match_id AND t.team_id=?
        GROUP BY perspective,s.zone''',(team_id,team_id))
    names={'central_box':'Центр штрафной','wide_box':'Фланги штрафной','outside_box':'Вне штрафной','unknown':'Неизвестная зона'}
    for r in rows:
        r['zone_label']=names[r['zone']]; r['perspective_label']='Свои удары' if r['perspective']=='for' else 'Удары соперников'
    return rows


def compute_research(team_id,df=None):
    df=frame() if df is None else df; g=df[df.team_id==team_id]; other=df[df.team_id!=team_id]
    tests=hypotheses(g); ids=g.match_id.astype(int).tolist(); ev=[]
    metrics=['xg','xga','xgd','shots','shot_quality','pass_accuracy','pass_share',
             'progressive_passes','shots_against','dangerous_against','goals_for','goals_against']
    comparisons=[]; correlations=[]
    for metric in metrics:
        val=g[metric].mean(); bench=other[metric].mean()
        ev.append(evidence(team_id,metric,val,bench,ids,'Среднее по матчам; ориентир — остальные 19 клубов, не норматив качества.'))
        comparisons.append({'metric':metric,'label':METRIC_LABELS[metric],'team':val,'league_others':bench,
                            'by_result':[{'result':RESULT_LABELS[r],'n':int(((g.result==r)&g[metric].notna()).sum()),
                                          'mean':g.loc[g.result==r,metric].mean()} for r in ('W','D','L')]})
        rho=stats.spearmanr(g[metric],g.points,nan_policy='omit').statistic if g[metric].nunique()>1 else None
        correlations.append({'metric':metric,'label':METRIC_LABELS[metric],'spearman_with_points':rho,
                             'note':'Разведочная корреляция без отдельного утверждения о значимости; голы связаны с результатом по определению.'})
    central=float(g.central_xga.sum()/g.xga.sum()) if g.xga.sum() else 0
    central_other=float(other.central_xga.sum()/other.xga.sum())
    ecentral=evidence(team_id,'central_xga_share',central,central_other,ids,
        'Доля допущенного xG из центральной штрафной; высокая доля не означает высокий абсолютный xGA.')
    ecentral['label']='Доля xGA из центра штрафной'; ev.append(ecentral)
    xpts=np.array([goal_probabilities(r.xg,r.xga)['expected_points'] for r in g.itertuples()])
    gap=g.points.to_numpy()-xpts; rng=np.random.default_rng(team_id)
    boot=gap[rng.integers(0,len(g),(1500,len(g)))].mean(axis=1)
    egap=evidence(team_id,'points_minus_poisson',gap.mean(),0,ids,
        'Фактические очки минус описательные ожидаемые очки из xG-Пуассона; не доказательство удачи или качества тренера.')
    egap['label']='Очки сверх описательной модели xG'; egap['kind']='Наблюдаемые данные и модель Пуассона'; ev.append(egap)
    conversion=float(g.shot_goals.sum()-g.xg.sum())
    ev.append({**evidence(team_id,'finishing_gap',conversion,0,ids,'Голы из ударов минус xG; автоголы исключены. Отклонение может отражать шум и особенности модели.'),
               'label':'Голы из ударов минус xG'})
    findings=[
        {'id':f'team:{team_id}:finding:volume_quality','title':'Объём и качество ударов',
         'status':'Описательное наблюдение','supported_pattern':bool(g.shots.mean()>other.shots.mean() and g.shot_quality.mean()<other.shot_quality.mean()),
         'text':f'Удары за матч: {g.shots.mean():.2f} против {other.shots.mean():.2f}; средний xG удара: {g.shot_quality.mean():.3f} против {other.shot_quality.mean():.3f}.',
         'evidence_ids':[f'team:{team_id}:season:shots',f'team:{team_id}:season:shot_quality']},
        {'id':f'team:{team_id}:finding:central','title':'Где соперник создаёт опасность',
         'status':'Описательное наблюдение','supported_pattern':bool(central>central_other),
         'text':f'Центр штрафной даёт {central:.1%} допущенного xG; у остальных клубов {central_other:.1%}. Абсолютный xGA за матч: {g.xga.mean():.2f}.',
         'evidence_ids':[ecentral['id'],f'team:{team_id}:season:xga']},
        {'id':f'team:{team_id}:finding:expected_actual','title':'Качество моментов и фактические очки',
         'status':'Описательная модель с неопределённостью','supported_pattern':bool(abs(gap.mean())>.1),
         'text':f'Фактические очки: {g.points.sum():.0f}; описательная модель xG-Пуассона: {xpts.sum():.2f}.',
         'mean_gap_interval_95':np.quantile(boot,[.025,.975]).tolist(),'evidence_ids':[egap['id']],
         'limitation':'Порог 0.1 очка за матч — порог показа наблюдения, не статистическая значимость.'}]
    home=g[g.is_home==1]; away=g[g.is_home==0]
    return clean({'team':club(team_id),'problem':{'question':'Почему клуб теряет очки и какие изменения приоритетно проверить?',
        'user':'Тренерский штаб','points_dropped':int(g.points_dropped.sum()),'decision':'Выбрать проверяемый тактический эксперимент.'},
        'stages':[{'stage':1,'label':'Постановка проблемы'},{'stage':2,'label':'Подготовка данных','source_endpoint':'/api/meta'},
                  {'stage':3,'label':'Аналитика и AI'},{'stage':4,'label':'Проверка гипотез'},
                  {'stage':5,'label':'Решение и последующая оценка','advisor_endpoint':'/api/advisor'}],
        'comparisons':comparisons,'correlations':correlations,'hypotheses':tests,'findings':findings,
        'shot_zones':zones(team_id),'evidence':ev,
        'context':{'home_xgd':home.xgd.mean(),'away_xgd':away.xgd.mean(),'recent_five':aggregate(g.tail(5))},
        'chance_diagnosis':{'creation_xg_per_match':g.xg.mean(),'finishing_goals_minus_xg':conversion,
                           'defending_xga_per_match':g.xga.mean(),
                           'interpretation':'Сравнивайте создание, реализацию и защиту отдельно. Отклонение голов от xG не доказывает устойчивую проблему завершения.'},
        'opponent_endpoint':f'/api/clubs/{team_id}/opponents','limitations':LIMITATIONS})


def prepare_research():
    df=frame()
    for tid in sorted(df.team_id.unique()):
        research=compute_research(int(tid),df)
        with connection(readonly=False) as conn:
            put_meta(conn,f'research:{tid}',research); conn.commit()


def research(team_id):
    club(team_id); return get_meta(f'research:{team_id}')


def match_analysis(match_id,team_id):
    club(team_id); rows=query('SELECT * FROM team_matches WHERE match_id=? ORDER BY is_home DESC',(match_id,))
    if not rows:
        raise ValueError('Матч с таким ID не найден.')
    if team_id not in [r['team_id'] for r in rows]:
        raise ValueError('Выбранный клуб не участвовал в матче.')
    shots=query('SELECT * FROM shots WHERE match_id=? ORDER BY minute,event_id',(match_id,))
    outcomes={'Goal':'Гол','Saved':'Отражён','Saved to Post':'Отражён в каркас','Saved Off Target':'Отражён мимо ворот',
              'Blocked':'Заблокирован','Off T':'Мимо','Post':'Каркас ворот','Wayward':'Неточный'}
    for s in shots:
        s['outcome_label']=outcomes.get(s['outcome'],'Другой исход'); s['is_selected_team']=s['team_id']==team_id
        s['evidence_id']=f'shot:{s["event_id"]}'
    players={r['player_id']:r['name'] for r in query('SELECT player_id,name FROM lineups WHERE match_id=?',(match_id,))}
    for s in shots:
        s['player_name']=players.get(s['player_id'],'Игрок не указан')
    patterns=query('SELECT * FROM pass_patterns WHERE match_id=?',(match_id,))
    match=query('SELECT * FROM matches WHERE match_id=?',(match_id,))[0]; quality=json.loads(match.pop('quality'))
    return clean({'match':match,'team':club(team_id),'teams':[{**r,'name':club(r['team_id'])['name'],
        'result_label':RESULT_LABELS[r['result']]} for r in rows], 'shots':shots,
        'pass_patterns':patterns,'visuals':match_visuals(shots,rows,patterns,team_id),
        'lineups':[{**r,'positions':json.loads(r['positions'])} for r in query('SELECT * FROM lineups WHERE match_id=?',(match_id,))],
        'quality':quality,'evidence_id':f'match:{match_id}:team:{team_id}',
        'coordinate_note':'Поле 120 × 80. Все удары направлены к x=120 в системе атакующей команды; при общей карте соперника нужно отразить.',
        'limitations':LIMITATIONS})
