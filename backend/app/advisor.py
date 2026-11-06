"""Правила принятия решений с измеримыми основаниями и явными допущениями."""
from __future__ import annotations

import numpy as np

from app.data import frame,club,evidence,clean,get_meta
from app.analytics import research
from app.opponents import opponent_analysis
from app.simulator import simulate, DEFAULT_SCENARIOS
from app.coaching import representative_match, team_snapshot, indicator_comparison, PROFILE_MARGINS, ru


def advise(team_id,opponent_id=None,is_home=True,priority='balanced',max_interventions=2,priority_strength=.15,scenario=None,as_of=None):
    selected=club(team_id); r=research(team_id); df=frame()
    if as_of:
        df=df[df.match_date<str(as_of)]
    g=df[df.team_id==team_id]; league=df[df.team_id!=team_id]
    alternatives=[dict(s) for s in DEFAULT_SCENARIOS]
    if scenario:
        alternatives=[scenario if s['id']==scenario['id'] else s for s in alternatives]
        if scenario['id'] not in {s['id'] for s in alternatives}:
            alternatives.append(scenario)
    sim=simulate(team_id,opponent_id,is_home,as_of=as_of,scenarios=alternatives,priority=priority,
                 max_interventions=max_interventions,priority_strength=priority_strength)
    opp=opponent_analysis(team_id,opponent_id); ev={e['id']:e for e in r['evidence']}
    if as_of:
        ids=g.match_id.astype(int).tolist()
        metrics=['xg','xga','xgd','shots','shot_quality','pass_accuracy','pass_share','progressive_passes','dangerous_against']
        historical=[evidence(team_id,m,g[m].mean(),league[m].mean(),ids,
            f'Только завершённые матчи до {as_of}; описательное сравнение с остальными клубами.',suffix=f'before:{as_of}') for m in metrics]
        central=evidence(team_id,'central_xga_share',g.central_xga.sum()/g.xga.sum(),
            league.central_xga.sum()/league.xga.sum(),ids,'Доля xGA из центра штрафной до выбранной даты.',suffix=f'before:{as_of}')
        central['label']='Доля xGA из центра штрафной'
        historical.append(central)
        ev={e['id']:e for e in historical}
    for e in sim['baseline']['evidence']:
        ev[e['id']]=e
    bymetric={e['metric']:e for e in ev.values() if ':simulation:' not in e['id']}
    scenario_results={s['id']:s for s in sim['scenarios']}
    drop=g[g.points<3]; win=g[g.points==3]
    outcome_evidence={}
    if min(len(drop),len(win))>=5:
        for metric in ('xg','xga','shot_quality'):
            e=evidence(team_id,metric,drop[metric].mean(),win[metric].mean(),drop.match_id.astype(int).tolist(),
                f'Без победы: {len(drop)} матчей; ориентир — {len(win)} побед. Различия соперников и хода игры не учтены.',
                suffix=(f'before:{as_of}' if as_of else 'season')+':nonwinning')
            e['label']={'xg':'xG за матч без победы','xga':'xGA за матч без победы','shot_quality':'Средний xG удара без победы'}[metric]
            ev[e['id']]=e;outcome_evidence[metric]=e
    # Плохой относительно лиги показатель и ухудшение в матчах с потерей очков — разные описательные сигналы.
    def worse_low(metric):
        ref=float(league[metric].mean()); own=float(g[metric].mean())
        group_gap=(float(win[metric].mean()-drop[metric].mean())/max(abs(float(win[metric].mean())),1e-6)) if len(win) and len(drop) else 0
        return float(np.clip(max((ref-own)/max(abs(ref),1e-6),group_gap),0,1))
    quality_severity=worse_low('shot_quality'); creation_severity=worse_low('xg')
    defense_severity=float(np.clip(max((g.xga.mean()-league.xga.mean())/league.xga.mean(),
        (drop.xga.mean()-win.xga.mean())/max(drop.xga.mean(),.01) if len(win) and len(drop) else 0),0,1))
    context_group=None
    if opponent_id is not None:
        cid=opp['opponent_context']['cluster_id']
        context_group=next(x for x in opp['against_styles'] if x['cluster_id']==cid)
    else:
        available=[x for x in opp['against_styles'] if x['matches']>=3]
        context_group=max(available,key=lambda x:x['xga']-x['xg']) if available else None
    context_ev=None
    # Группы полного сезона нельзя использовать как предматчевое знание.
    if as_of:
        context_group=None
    if context_group:
        context_ev=evidence(team_id,'style_xgd',context_group['xg']-context_group['xga'],g.xgd.mean(),context_group['match_ids'],
            'Ретроспективная группа стиля соперника; различие может отражать силу команд и малую выборку.',
            suffix=f'style:{context_group["cluster_id"]}')
        context_ev['label']='Разница xG против группы соперников'; ev[context_ev['id']]=context_ev
    candidates=[
        {'id':'quality','title':'Проверить выбор более качественных ударных позиций','area':'attack','severity':quality_severity,
         'problem':f'Средний xG удара {ru(g.shot_quality.mean(),3)}; ориентир других клубов {ru(league.shot_quality.mean(),3)}. В матчах без победы {ru(drop.shot_quality.mean(),3)}.',
         'evidence_ids':[bymetric['shot_quality']['id'],bymetric['shots']['id']],
         'experiment':'На тренировках отработать выход под удар из центра штрафной через прострел и обратную передачу; в матчах фиксировать выбор позиции до удара.',
         'evaluate':'В следующих 5 матчах сравнить xG/удар, долю ударов из центра штрафной и общий xG с исходной базой, отдельно по полю и силе соперника.',
         'risks':['Отказ от ранних ударов может снизить объём моментов.','Качество обороны соперников влияет на доступность зон.']},
        {'id':'defense','title':'Проверить защиту центральной зоны перед воротами','area':'defense','severity':defense_severity,
         'problem':f'xGA за матч {ru(g.xga.mean())} против {ru(league.xga.mean())}; {ru(g.central_xga.sum()/g.xga.sum()*100,1)}% xGA возникает в центре штрафной.',
         'evidence_ids':[bymetric['xga']['id'],bymetric['central_xga_share']['id'],bymetric['dangerous_against']['id']],
         'experiment':'Проверить согласованное смещение опорного игрока и центральных защитников при входе соперника в штрафную; компактность — гипотеза, её нужно оценить по видео.',
         'evaluate':'В следующих 5 матчах сравнить xGA, опасные удары с xG≥0,20 и центральный xGA; дополнить видеоразбором открытых зон и контролем допущенных фланговых атак.',
         'risks':['Усиление центра может открыть фланги.','Снижение числа атакующих игроков может ухудшить создание моментов.']},
        {'id':'creation','title':'Проверить увеличение частоты качественно подготовленных атак','area':'attack','severity':creation_severity,
         'problem':f'xG за матч {ru(g.xg.mean())} против {ru(league.xg.mean())}; удары за матч {ru(g.shots.mean())} против {ru(league.shots.mean())}.',
         'evidence_ids':[bymetric['xg']['id'],bymetric['shots']['id'],bymetric['progressive_passes']['id']],
         'experiment':'Отработать прогрессивную передачу в последнюю треть и поддержку второй линии; проверить, растёт ли число завершённых атак без ухудшения качества ударов.',
         'evaluate':'Сравнить удары, xG, xG/удар и завершённые прогрессивные передачи в следующих 5 матчах; одновременно контролировать xGA после потерь по видео.',
         'risks':['Дополнительные удары могут быть низкого качества.','Рост вовлечённости в атаке увеличивает риск контратак.']},
    ]
    if context_group and context_ev:
        severity=float(np.clip((g.xgd.mean()-context_ev['value'])/max(abs(g.xgd.mean()),.5),0,1))
        candidates.append({'id':'combined','title':'Проверить адаптацию к наблюдаемой группе соперников','area':'balanced','severity':severity,
            'problem':f'Против группы «{context_group["name"]}»: {context_group["matches"]} матчей, xG {ru(context_group["xg"])}, xGA {ru(context_group["xga"])}; средняя разница xG клуба {ru(g.xgd.mean())}.',
            'evidence_ids':[context_ev['id'],bymetric['xgd']['id']],
            'experiment':'Разобрать матчи указанной группы на видео и проверить один способ продвижения к опасной зоне с согласованной страховкой потерь.',
            'evaluate':'Проверить средний xG и xGA в следующих встречах с похожим событийным профилем; сохранять отдельную выборку и не переносить вывод на все стили.',
            'risks':['Группа смешивает стиль и силу состава.','Кластер полного сезона не был известен перед историческими матчами.']})
    for c in candidates[:3]:
        metric={'quality':'shot_quality','creation':'xg','defense':'xga'}[c['id']]
        direction='higher' if metric=='xga' else 'lower'
        league_signal=indicator_comparison(g[metric],float(league[metric].mean()),metric)['status']==direction
        outcome=outcome_evidence.get(metric)
        absolute,relative=PROFILE_MARGINS[metric]
        outcome_signal=outcome is not None and (1 if metric=='xga' else -1)*(outcome['value']-outcome['benchmark'])>=max(absolute,abs(outcome['benchmark'])*relative)
        if outcome_signal:
            c['evidence_ids'].insert(0,outcome['id'])
            c['problem']+=f" Без победы (n={len(drop)}): {ru(outcome['value'],3 if metric=='shot_quality' else 2)}; в победах (n={len(win)}): {ru(outcome['benchmark'],3 if metric=='shot_quality' else 2)}. Соперники и ход игры различаются; причинность не установлена."
        if not league_signal and not outcome_signal:
            c['severity']=0
            c['problem']='Выраженная слабость по этому направлению не установлена. '+c['problem']
    if scenario and scenario['id'] not in {c['id'] for c in candidates}:
        related=[]
        if scenario.get('xga_reduction',0): related.append(candidates[1])
        if scenario.get('shot_quality_change',0): related.append(candidates[0])
        if scenario.get('shot_volume_change',0) or scenario.get('attack_xg_change',0): related.append(candidates[2])
        parent=max(related or candidates,key=lambda c:c['severity'])
        candidates.append({**parent,'id':scenario['id'],'title':'Проверить выбранный тренером сценарий: '+scenario['title'],
                           'evidence_ids':list(dict.fromkeys(e for c in related or [parent] for e in c['evidence_ids']))})
    alignment_weight=.1+priority_strength*.2
    weights={'diagnostic':.45*(1-alignment_weight),'evidence_quality':.30*(1-alignment_weight),
             'modeled_gain':.10*(1-alignment_weight),'sample_support':.15*(1-alignment_weight),
             'priority_alignment':alignment_weight}
    recommendations=[]
    for c in candidates:
        sc=scenario_results[c['id']]; n=context_group['matches'] if c['id']=='combined' and context_group else len(g)
        is_cluster=c['id']=='combined' and context_group is not None
        group_clubs=len(next(x for x in opp['style_model']['clusters'] if x['cluster_id']==context_group['cluster_id'])['team_ids']) if is_cluster else None
        reliability=min(.4,group_clubs/(group_clubs+8))*n/(n+6) if is_cluster else .85*n/(n+5)
        support=n/(n+15)
        alignment=1. if priority=='balanced' or c['area']==priority else .5
        components={'diagnostic':c['severity']*reliability,'evidence_quality':reliability,
                    'modeled_gain':float(np.clip(sc['delta_expected_points']/.20,0,1))*reliability,
                    'sample_support':support,'priority_alignment':alignment}
        score=sum(weights[k]*components[k] for k in weights)
        sensitivity=[]
        for w in (.2,.3,.4):
            varied={k:(v*(1-w)/(1-weights['modeled_gain']) if k!='modeled_gain' else w) for k,v in weights.items()}
            sensitivity.append({'gain_weight':w,'score':sum(varied[k]*components[k] for k in varied)})
        ev_ids=list(dict.fromkeys(c['evidence_ids']+sc['evidence_ids']))
        match_metric='central_xga' if c['area']=='defense' else 'shot_quality' if c['id']=='quality' else 'xg' if c['id']=='creation' else 'xgd'
        selection=representative_match(g,match_metric,context_group['match_ids'] if is_cluster else None)
        recommendations.append({'id':f'team:{team_id}:recommendation:{c["id"]}',
            'supporting_match_id':selection['match_id'],'evidence_match_criterion':selection['criterion'],
            'evidence_quality':{'reliability':reliability,'sample_size':n,'cluster_clubs':group_clubs,
                'note':'Кластер разведочный: стиль смешан с силой соперника; малые группы и выборки снижают приоритет.' if is_cluster else 'Прямые событийные показатели; наблюдательная поддержка, не причинное доказательство.'},
            'title':c['title'],'diagnosed_problem':c['problem'],
            'status':'Основание для проверки' if c['severity']>.05 else 'Разведочный эксперимент: выраженный относительный дефицит не установлен',
            'evidence_ids':ev_ids,'supporting_metrics':[ev[i] for i in ev_ids],
            'opponent_context':context_group if c['id']=='combined' or opponent_id is not None else None,
            'experiment':c['experiment'],'evaluation_plan':c['evaluate'],
            'scenario_id':sc['id'],'scenario_assumptions':sc['assumptions'],
            'modeled_delta_expected_points':sc['delta_expected_points'],
            'modeled_sensitivity':sc['sensitivity'],'interventions':sc['interventions'],'eligible':sc['eligible'],
            'score':score,'score_components':components,'score_sensitivity':sensitivity,
            'risks':c['risks'],'uncertainty':[
                'Причинный эффект инструкции не измерен; процент изменения из выбранного сценария является проверяемым допущением.',
                f'Основание содержит {n} матчей; сравнение с лигой не учитывает различие силы соперников.',
                'Пятиматчевая проверка даёт ранний сигнал, а не достаточное доказательство; сохраняйте все наблюдения и интервалы.']})
    recommendations.sort(key=lambda c:c['score'],reverse=True)
    used=0
    for rec in recommendations:
        rec['selected_for_testing']=rec['eligible'] and used+rec['interventions']<=max_interventions
        if rec['selected_for_testing']:
            used+=rec['interventions']
    metrics=get_meta('prediction')
    return clean({'team':selected,'opponent':club(opponent_id) if opponent_id else None,
        'selected_scenario_id':scenario['id'] if scenario else None,
        'diagnosis':team_snapshot(team_id,df,as_of=as_of),
        'recommendations':recommendations,'evidence':list(ev.values()),'simulation':sim,
        'ranking':{'weights':weights,'definition':'Взвешенная сумма пяти компонентов. Качество основания снижает вклад дефицита и предполагаемого эффекта. Это эвристический приоритет проверки, не вероятность успеха.',
            'components':{'diagnostic':'Относительный дефицит к лиге или ухудшение без победы × качество основания; 0..1.',
                'evidence_quality':'Прямые показатели: 0.85n/(n+5). Кластер: min(0.4, k/(k+8)) × n/(n+6), где k — клубов в группе. Коэффициенты плановые, не вероятности.',
                'modeled_gain':'Прирост ожидаемых очков / 0.20, ограниченный 0..1, × качество основания. В основной формуле вес около 9%.',
                'sample_support':'n/(n+15); эвристическая поддержка выборкой, не статистическая вероятность.',
                'priority_alignment':'1 при соответствии выбранному приоритету либо балансе; иначе 0.5.'},
            'max_interventions':max_interventions,'resource_assumption':'Ограничение числа направлений задано пользователем; финансовые ограничения не моделируются.'},
        'model_context':{'model_name':metrics['selected_model_name'],'test_comparison':metrics['test_comparison'],
                         'note':'ML оценивает исторический исход по предматчевой форме. Важности признаков не используются как причинные эффекты инструкций.'},
        'measured':'События, счёт, передачи и зоны ударов записаны источником; xG оценён внешней моделью StatsBomb.',
        'modeled':'Базовые вероятности Пуассона, предполагаемый прирост и эвристический балл приоритета.',
        'limitations':['Рекомендации — гипотезы для тренерской проверки, а не доказанные причины поражений.',
                       f'Диагностика использует только матчи до {as_of}; кластеры полного сезона исключены из приоритета.' if as_of else 'Диагностика полного сезона ретроспективна; кластеры используются только как разведочное основание.',
                       'xG — оценка StatsBomb качества удара, а не измеренный причинный потенциал тактического действия.']})
