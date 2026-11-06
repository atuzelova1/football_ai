"""Краткие тренерские представления существующих расчётов; исходные данные неизменны."""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

from app.data import clean, club, evidence, frame, get_meta


def ru(value, digits=2):
    return f'{value:.{digits}f}'.replace('.', ',')


# Пороги практического описания, не уровни статистической значимости.
PROFILE_MARGINS = {'xg':(.15,.10), 'xga':(.15,.10), 'shots':(1.5,.10),
                   'shot_quality':(.01,.10), 'pass_accuracy':(.03,0), 'directness':(.03,0)}


def indicator_comparison(values, benchmark, metric):
    values = np.asarray(values.dropna(), dtype=float)
    n = len(values)
    if not n or not np.isfinite(benchmark):
        return {'sample_size':n,'status':'uncertain','mean_interval':None,
                'interpretation':'Недостаточно данных для сравнения.'}
    value = float(values.mean())
    absolute, relative = PROFILE_MARGINS[metric]
    margin = max(absolute, abs(benchmark)*relative)
    interval = np.quantile(np.random.default_rng(2026).choice(values,(1000,n)).mean(axis=1),[.025,.975])
    delta = value-benchmark
    if abs(delta) < margin:
        status, text = 'parity', 'Показатель находится примерно на уровне лиги.'
    elif n < 12 or interval[0] <= benchmark <= interval[1]:
        status, text = 'uncertain', 'Наблюдаемое отклонение неустойчиво; уверенно выделить особенность нельзя.'
    else:
        status = 'higher' if delta > 0 else 'lower'
        text = 'Наблюдаемое среднее заметно '+('выше' if delta > 0 else 'ниже')+' ориентира лиги.'
    if n < 12:
        text += ' Мало матчей для устойчивого профиля.'
    return clean({'sample_size':n,'status':status,'delta':delta,'descriptive_margin':margin,
                  'mean_interval':interval,'interpretation':text})


def match_xg_comparison(xg, xga):
    """Суммарный xG отражает и количество, и качество ударов."""
    delta = xg-xga
    balanced = max(.15,.10*max(xg,xga))
    substantial = max(.75,.35*max(xg,xga))
    if abs(delta) <= balanced:
        category, issue = 'balanced', 'По суммарному xG команды создали примерно равноценные моменты.'
    else:
        category = 'substantial' if abs(delta) >= substantial else 'moderate'
        side = 'выбранной команды' if delta > 0 else 'соперника'
        issue = ('Существенно' if category == 'substantial' else 'Умеренно')+f' больше суммарного xG у {side}.'
    return {'category':category,'difference':delta,'issue':issue,
            'note':'Описательные пороги: баланс — до максимума 0,15 xG и 10% большего xG; существенное различие — от максимума 0,75 xG и 35%. Это не тест значимости и не доказательство причины результата.'}


def representative_match(g, metric, allowed_ids=None):
    """Целевой отбор эпизода с сильным отклонением, а не «типичного» матча."""
    pool = g[g.points < 3]
    if allowed_ids is not None:
        pool = pool[pool.match_id.isin(allowed_ids)]
    if pool.empty:
        pool = g if allowed_ids is None else g[g.match_id.isin(allowed_ids)]
    if pool.empty:
        raise ValueError('Нет матчей для проверки выбранного основания.')
    low = metric in ('shot_quality','xg','xgd')
    usable = pool[pool[metric].notna()]
    if metric == 'shot_quality' and (usable.shots >= 5).any():
        usable = usable[usable.shots >= 5]
    if usable.empty:
        usable = pool
        metric, low = 'xga', False
    ranked = usable.sort_values([metric,'match_date','match_id'],ascending=[low,False,False])
    labels = {'xga':'xGA','central_xga':'xGA из центра штрафной','xg':'созданный xG',
              'shot_quality':'средний xG удара','xgd':'разница xG'}
    criterion = f"{'Наименьший' if low else 'Наибольший'} {labels[metric]} среди доступных матчей без победы; при равенстве — более поздний матч."
    if metric == 'shot_quality':
        criterion += ' Если возможно, исключены встречи с менее чем пятью ударами.'
    return clean({'match_id':int(ranked.iloc[0].match_id),'match_ids':ranked.match_id.astype(int).head(3).tolist(),
        'metric':metric,'value':ranked.iloc[0][metric],'reference':g[metric].mean(),
        'criterion':criterion+' Это целевой отбор для разбора, не доказательство причины.'})


def team_snapshot(team_id, df=None, as_of=None):
    club(team_id)
    df = frame() if df is None else df
    if as_of:
        df = df[df.match_date < str(as_of)]
    g, rest = df[df.team_id == team_id], df[df.team_id != team_id]
    if g.empty:
        raise ValueError('Нет более ранних матчей для диагностики.')
    historical = as_of is not None
    r = None if historical else get_meta(f'research:{team_id}')
    tests = {} if historical else {h['id'].rsplit(':',1)[-1]:h for h in r['hypotheses']}
    comparisons = {m:indicator_comparison(g[m],float(rest[m].mean()),m) for m in ('xga','xg','shot_quality')}
    metric, title = 'xgd', 'Начните с конкретных матчей без победы'
    text = 'По выбранным показателям убедительной общей слабости относительно лиги не выделено.'
    ev_suffix = f'before:{as_of}' if historical else 'season'
    ev_id = f'team:{team_id}:{ev_suffix}:xgd'
    for m, direction, hypothesis, heading in [
        ('xga','higher','xga_dropped','Исследуйте допущенную опасность'),
        ('shot_quality','lower','quality_result','Проверьте качество ударных позиций'),
        ('xg','lower','xgd_result','Исследуйте создание моментов')]:
        delta=comparisons[m].get('delta',0)
        meaningful=(1 if direction=='higher' else -1)*delta>=comparisons[m].get('descriptive_margin',float('inf')) and len(g)>=12
        if meaningful and (historical or tests[hypothesis]['significant']):
            metric, title, ev_id = m, heading, f'team:{team_id}:{ev_suffix}:{m}'
            label = {'xga':'xGA за матч','xg':'xG за матч','shot_quality':'Средний матчевый xG удара'}[m]
            digits = 3 if m == 'shot_quality' else 2
            text = f'{label}: {ru(g[m].mean(),digits)} против {ru(rest[m].mean(),digits)} у остальных клубов. Это наблюдаемое различие, не установленная тактическая причина.'
            if comparisons[m]['status']=='uncertain':
                text+=' Среднее неустойчиво: интервал оценки перекрывает ориентир лиги.'
            break
    drop, win = g[g.points<3], g[g.points==3]
    outcome_comparison = []
    for m in ('xga','xg','shot_quality'):
        if len(drop) and len(win):
            outcome_comparison.append({'metric':m,'without_win':float(drop[m].mean()),
                'wins':float(win[m].mean()),'without_win_n':len(drop),'wins_n':len(win)})
    if metric == 'xgd' and min(len(drop),len(win)) >= 5:
        # Поиск вопросов внутри сильного клуба: сравнение исходов не выдаётся за причину.
        for m, sign, label in [('xga',1,'допущенную опасность'),('xg',-1,'создание моментов'),('shot_quality',-1,'выбор ударных позиций')]:
            a, b = float(drop[m].mean()), float(win[m].mean())
            absolute, relative = PROFILE_MARGINS[m]
            if sign*(a-b) >= max(absolute,abs(b)*relative):
                metric, title = m, f'Разберите {label} в матчах без победы'
                ev_id = f'team:{team_id}:{ev_suffix}:nonwinning:{m}'
                digits = 3 if m == 'shot_quality' else 2
                text += f' В матчах без победы ({len(drop)}) {dict(xg="xG",xga="xGA",shot_quality="xG/удар")[m]}: {ru(a,digits)}, в победах ({len(win)}) — {ru(b,digits)}. Это вопрос для разбора, а не доказанная слабость: отличаются соперники и ход игры.'
                break
    selection = representative_match(g,metric)
    extra_evidence=[]
    if ':nonwinning:' in ev_id:
        extra_evidence=[evidence(team_id,metric,drop[metric].mean(),win[metric].mean(),drop.match_id.astype(int).tolist(),
            f'Матчи без победы: {len(drop)}; ориентир — {len(win)} побед. Соперники и ход игры различаются.',suffix=ev_suffix+':nonwinning')]
    return clean({'title':title,'text':text,'metric':metric,'evidence_id':ev_id,
        'match_id':selection['match_id'],'match_selection':selection,
        'scope':f'Только матчи до {as_of}; n={len(g)}' if historical else f'Сезон 2015/16; {len(g)} матчей',
        'observations':[] if historical else r['findings'],'outcome_comparison':outcome_comparison,'evidence':extra_evidence,
        'interpretation_note':'Порог отклонения и интервал среднего служат осторожному описанию, не заменяют статистические гипотезы. Сравнение исходов не устанавливает причинность.'})


def opponent_snapshot(team_id, opponent_id, df=None):
    club(team_id); club(opponent_id)
    df = frame() if df is None else df
    g = df[df.team_id == opponent_id]
    rest = df[df.team_id != opponent_id]
    comparisons = []
    for metric, label in [('xg','xG за матч'),('xga','xGA за матч'),('shots','Удары за матч'),
                          ('shot_quality','Средний матчевый xG удара'),('pass_accuracy','Точность передач'),
                          ('directness','Направленность передач вперёд')]:
        benchmark = float(rest[metric].mean())
        comparisons.append({'metric':metric,'label':label,'value':float(g[metric].mean()),
                            'benchmark':benchmark,'team_value':float(df.loc[df.team_id==team_id,metric].mean()),
                            **indicator_comparison(g[metric],benchmark,metric)})
    by = {c['metric']:c for c in comparisons}
    strengths = [by[k] for k in ('xg','shot_quality') if by[k]['status']=='higher'][:2]
    vulnerabilities = [by[k] for k in ('xga','pass_accuracy') if
        by[k]['status']==('higher' if k=='xga' else 'lower')][:2]
    h = df[(df.team_id==team_id)&(df.opponent_id==opponent_id)]
    return clean({'comparisons':comparisons,'strengths':strengths,'vulnerabilities':vulnerabilities,
        'question':'Как сохранить создание моментов и ограничить сильные стороны этого соперника?',
        'match_ids':h.match_id.astype(int).tolist(),
        'neutral':[c for c in comparisons if c['status'] in ('parity','uncertain')],
        'method':'Описательные пороги: xG/xGA — максимум 0,15 и 10%; удары — максимум 1,5 и 10%; xG/удар — максимум 0,01 и 10%; точность и направленность — 3 процентных пункта. Не менее 12 матчей. Интервал среднего: бутстрэп матчей, 95%, 1000 повторов, фиксированный ориентир лиги. Это не тест значимости; календарь и зависимость матчей не учтены.',
        'note':'Сезонные событийные показатели. Возможные уязвимости требуют проверки по эпизодам; они не доказывают тактическую причину.'})


def match_snapshot(teams, shots, team_id):
    own = next(t for t in teams if t['team_id']==team_id)
    opp = next(t for t in teams if t['team_id']!=team_id)
    conceded = [s for s in shots if s['team_id']!=team_id]
    dangerous = [s for s in conceded if s['xg'] is not None and s['xg']>=.2]
    central = [s for s in conceded if s['zone']=='central_box']
    comparison = match_xg_comparison(own['xg'],own['xga'])
    issue = comparison['issue']+' Сравните удары и отдельные опасные эпизоды; xG не определяет результат.'
    return clean({'title':'Краткий разбор матча','result':own['result'],'issue':issue,
        'xg_leader':None if comparison['category']=='balanced' else own['team_id'] if own['xgd']>0 else opp['team_id'],
        'xg_comparison':comparison,
        'patterns':[f"Опасные удары соперника: {len(dangerous)} с xG не ниже 0,20.",
                    f"Центр штрафной: {len(central)} ударов соперника, xGA {ru(sum(s['xg'] or 0 for s in central))}.",
                    f"Качество своего удара: {ru(own['shot_quality'],3)}." if own['shot_quality'] is not None else 'У клуба не было ударов.'],
        'dangerous_event_ids':[s['event_id'] for s in dangerous],
        'central_event_ids':[s['event_id'] for s in central],
        'low_quality_event_ids':[s['event_id'] for s in shots if s['team_id']==team_id and s['xg'] is not None and s['xg']<.05],
        'note':'Выберите эпизоды для ручного видеоразбора. Встроенных видео и трекинга нет.'})


def build_context(body):
    """Контекст строится сервером, а не из присланных клиентом метрик."""
    from app.advisor import advise
    from app.prediction import predict
    from app.analytics import match_analysis
    values = body.model_dump() if hasattr(body,'model_dump') else dict(body)
    team_id, opponent_id = values['team_id'], values.get('opponent_id')
    advisor_args = {k:values[k] for k in ('team_id','opponent_id','is_home','priority',
        'max_interventions','priority_strength','scenario','as_of') if k in values}
    selected_match = None
    if values.get('match_id'):
        selected_match = match_analysis(values['match_id'],team_id)
        own = next(t for t in selected_match['teams'] if t['team_id']==team_id)
        if opponent_id is not None and own['opponent_id']!=opponent_id:
            raise ValueError('Матч и выбранный соперник не соответствуют друг другу.')
    prediction = None
    if values.get('historical_match_id'):
        prediction = predict(team_id,opponent_id,match_id=values['historical_match_id'])
        context = prediction['context']
        if context['is_home']!=values['is_home'] or (values.get('as_of') and str(values['as_of'])!=context['match_date']):
            raise ValueError('Поле или дата не соответствуют историческому ML-контексту.')
        if values.get('match_id') and values['match_id']!=context['match_id']:
            raise ValueError('Выбранный матч отличается от исторического ML-контекста.')
        advisor_args['as_of'] = context['match_date']
    advice = advise(**advisor_args)
    research = get_meta(f'research:{team_id}')
    selected = next((r for r in advice['recommendations'] if r['scenario_id']==advice['selected_scenario_id']),None)
    primary = next((r for r in advice['recommendations'] if r['selected_for_testing']),advice['recommendations'][0])
    # От выбранной гипотезы к исходным показателям, затем несколько общих ориентиров.
    wanted = list(dict.fromkeys(primary['evidence_ids']+[i for r in advice['recommendations'] for i in r['evidence_ids']]+[f'team:{team_id}:season:{m}' for m in
        ['xg','xga','shots','shot_quality','central_xga_share','pass_share']]))
    lookup = {e['id']:e for e in advice['evidence']}
    wanted = list(dict.fromkeys(wanted+list(lookup)))
    ev = [lookup[key] for key in wanted if key in lookup][:24]
    examples = []
    df = frame()
    if advice['simulation']['baseline']['as_of']:
        df = df[df.match_date < advice['simulation']['baseline']['as_of']]
    own_rows = df[df.team_id==team_id]
    if selected_match and values['match_id'] in set(own_rows.match_id):
        row = own_rows[own_rows.match_id==values['match_id']]
        examples.extend(row.to_dict('records'))
    for _,row in own_rows[own_rows.points<3].sort_values('xga',ascending=False).head(3).iterrows():
        if row.match_id not in {r['match_id'] for r in examples}:
            examples.append(row.to_dict())
    examples = [{k:r[k] for k in ['match_id','match_date','opponent_id','opponent_name','is_home',
        'goals_for','goals_against','xg','xga','shots','dangerous_against']} for r in examples[:3]]
    simulation = advice['simulation']
    return clean({'team':advice['team'],'opponent':advice['opponent'],'season':'2015/2016',
        'is_home':values['is_home'],'as_of':simulation['baseline']['as_of'],
        'selected_match_id':values.get('match_id'),'historical_match_id':values.get('historical_match_id'),
        'diagnosis':advice['diagnosis'],'observed_match_examples':examples,
        'opponent_profile':opponent_snapshot(team_id,opponent_id,df) if opponent_id else None,
        'hypotheses':[] if simulation['baseline']['as_of'] else [{k:h[k] for k in ['id','question','sample_size','statistic','p_adjusted','significant']} for h in research['hypotheses']],
        'ml':{'context':prediction['context'],'probabilities':prediction['probabilities'],
              'model_name':prediction['model_name']} if prediction else None,
        'ml_note':'Индивидуальный исторический прогноз не выбран.' if not prediction else 'Вероятности классификатора; не вероятности сценарной модели.',
        'model_validation':{'fit_end':get_meta('prediction')['fit_end'],
            'test':get_meta('prediction')['models'][get_meta('prediction')['selected_model']]['test']['log_loss'],
            'comparison':get_meta('prediction')['test_comparison']['interpretation']},
        'simulation':simulation,'selected_scenario_id':advice['selected_scenario_id'],
        'recommendations':[{k:r[k] for k in ['id','title','diagnosed_problem','experiment','evaluation_plan',
            'scenario_id','scenario_assumptions','modeled_delta_expected_points','score','eligible','selected_for_testing','risks','evidence_ids','evidence_quality','evidence_match_criterion','supporting_match_id','status']}
            for r in advice['recommendations']],
        'primary_recommendation_id':primary['id'],'evidence':ev,
        'scopes':{'diagnosis':advice['diagnosis']['scope'],
                  'match_examples':'Матчи строго до даты сценария, если она выбрана; иначе ретроспектива сезона.',
                  'simulation':'Только более ранние матчи при наличии as_of; иначе полный сезон.',
                  'xg':'Внешняя модель StatsBomb, не измеренное число голов.',
                  'assumptions':'Проценты сценария заданы тренером; тактический эффект не измерен.'},
        'limitations':advice['limitations']+['Нет видео, трекинга, актуальных составов и травм.','Группы из 18 и 2 клубов описательные; сила команд смешана со статистическим сходством.']})


def coaching_brief(body):
    context = build_context(body)
    values = body.model_dump() if hasattr(body,'model_dump') else body
    rec_id = values.get('recommendation_id') or context['primary_recommendation_id']
    rec = next((r for r in context['recommendations'] if r['id']==rec_id),None)
    if rec is None:
        raise ValueError('Рекомендация не относится к выбранному контексту.')
    sim = context['simulation']
    scenario = next(s for s in sim['scenarios'] if s['id']==rec['scenario_id'])
    rows = frame()
    supporting = rows[(rows.team_id==context['team']['team_id']) & (rows.match_id==rec['supporting_match_id'])].iloc[0]
    return {'created_at':datetime.now(timezone.utc).isoformat(),'team':context['team'],
        'opponent':context['opponent'],'season':context['season'],'is_home':context['is_home'],
        'as_of':context['as_of'],'match_id':context['selected_match_id'],'diagnosis':context['diagnosis'],
        'supporting_match':{'date':supporting.match_date,'opponent':club(int(supporting.opponent_id)),
            'goals_for':int(supporting.goals_for),'goals_against':int(supporting.goals_against)},
        'recommendation':rec,'baseline':sim['baseline'],'scenario':scenario,
        'alternatives':[{k:r[k] for k in ('title','experiment','modeled_delta_expected_points')}
                        for r in context['recommendations'] if r['id']!=rec_id][:2],
        'evidence':[e for e in context['evidence'] if e['id'] in rec['evidence_ids']],
        'limitations':context['limitations'],'source':'StatsBomb Open Data (Hudl), La Liga 2015/2016',
        'source_revision':get_meta('coverage')['revision']}
