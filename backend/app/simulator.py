"""Прозрачная модель сценариев: предположения о xG, а не причинный эффект тактики."""
from __future__ import annotations

import numpy as np
from scipy.stats import poisson

from app.data import club, frame, clean, evidence


def goal_probabilities(attack: float, defense: float):
    if not np.isfinite([attack,defense]).all() or min(attack,defense)<0 or max(attack,defense)>20:
        raise ValueError('Параметры ожидаемых голов должны быть конечными числами от 0 до 20.')
    upper=int(max(poisson.ppf(1-1e-12,attack),poisson.ppf(1-1e-12,defense),1))
    goals=np.arange(upper+1)
    grid=np.outer(poisson.pmf(goals,attack),poisson.pmf(goals,defense))
    mass=float(grid.sum()); grid/=mass
    win=float(np.tril(grid,-1).sum()); draw=float(np.trace(grid)); loss=float(np.triu(grid,1).sum())
    return {'win':win,'draw':draw,'loss':loss,'expected_points':3*win+draw,
            'omitted_tail':max(0.,1-mass)}


def baseline(team_id, opponent_id=None, is_home=True, as_of=None):
    team=club(team_id)
    if opponent_id==team_id:
        raise ValueError('Клуб и соперник должны различаться.')
    opponent=club(opponent_id) if opponent_id is not None else None
    df=frame()
    if as_of:
        df=df[df.match_date<str(as_of)]
    selected=df[(df.team_id==team_id)&(df.is_home==int(is_home))]
    if len(selected)<3:
        raise ValueError('Для базового сценария требуется минимум три более ранних матча клуба в выбранном контексте.')
    opposite=df[df.is_home==int(not is_home)]
    opp=opposite[opposite.team_id==opponent_id] if opponent else opposite
    if len(opp)<3:
        raise ValueError('Недостаточно исторических матчей соперника для сценария.')
    league=df[df.is_home==int(is_home)]
    prior=5
    attack_team=(selected.xg.sum()+prior*league.xg.mean())/(len(selected)+prior)
    defense_team=(selected.xga.sum()+prior*league.xga.mean())/(len(selected)+prior)
    opp_def=(opp.xga.sum()+prior*opposite.xga.mean())/(len(opp)+prior)
    opp_att=(opp.xg.sum()+prior*opposite.xg.mean())/(len(opp)+prior)
    attack=float((attack_team+opp_def)/2); defense=float((defense_team+opp_att)/2)
    rng=np.random.default_rng(700+team_id+(opponent_id or 0))
    estimates=[]
    for _ in range(350):
        a=selected.iloc[rng.integers(0,len(selected),len(selected))]
        b=opp.iloc[rng.integers(0,len(opp),len(opp))]
        x=((a.xg.sum()+prior*league.xg.mean())/(len(a)+prior)+(b.xga.sum()+prior*opposite.xga.mean())/(len(b)+prior))/2
        y=((a.xga.sum()+prior*league.xga.mean())/(len(a)+prior)+(b.xg.sum()+prior*opposite.xg.mean())/(len(b)+prior))/2
        estimates.append((x,y,goal_probabilities(x,y)['expected_points']))
    ci=np.quantile(estimates,[.025,.975],axis=0)
    ev=[evidence(team_id,'xg',selected.xg.mean(),league.xg.mean(),selected.match_id,
                 'Среднее по матчам выбранного поля; база сглажена пятью матчами среднего уровня лиги.',suffix='simulation'),
        evidence(team_id,'xga',selected.xga.mean(),league.xga.mean(),selected.match_id,
                 'Наблюдаемая оборонительная нагрузка; не измерение компактности.',suffix='simulation')]
    return clean({'team':team,'opponent':opponent,'is_home':is_home,'as_of':str(as_of) if as_of else None,
        'mode':'Историческая предматчевая база' if as_of else 'Ретроспективная гипотетическая база сезона 2015/2016',
        'attack_xg':attack,'defense_xg':defense,'probabilities':goal_probabilities(attack,defense),
        'sample_size':len(selected),'opponent_sample_size':len(opp),'prior_matches':prior,
        'confidence_intervals':{'attack_xg':ci[:,0].tolist(),'defense_xg':ci[:,1].tolist(),
                                'expected_points':ci[:,2].tolist()},
        'evidence':ev,'match_ids':selected.match_id.astype(int).tolist(),
        'method':'Среднее сглаженного xG атаки клуба и xGA соперника; аналогично для защиты. Независимые голы Пуассона.',
        'uncertainty':'Процентильный бутстрэп 350 повторов, 95%. Матчи считаются независимыми; календарь и пересечение выборок могут занижать неопределённость.'})


def apply_changes(attack, defense, changes):
    volume=changes.get('shot_volume_change',0); quality=changes.get('shot_quality_change',0)
    direct=changes.get('attack_xg_change',0); reduction=changes.get('xga_reduction',0)
    values=[volume,quality,direct,reduction]
    if not np.isfinite(values).all() or any(abs(v)>.5 for v in values):
        raise ValueError('Изменения сценария должны быть конечными долями от −0.5 до 0.5.')
    if direct and (volume or quality):
        raise ValueError('Выберите прямое изменение xG либо объём/качество ударов: совместное применение дублирует xG.')
    # Объём и качество — разные множители единой тождественной формулы shots × xG/shot.
    a=attack*(1+direct) if direct else attack*(1+volume)*(1+quality)
    d=defense*(1-reduction)
    return a,d


DEFAULT_SCENARIOS = [
    {'id':'creation','title':'Создавать на 10% больше ударов','shot_volume_change':.10},
    {'id':'quality','title':'Повысить среднее качество удара на 10%','shot_quality_change':.10},
    {'id':'defense','title':'Снизить допускаемый xG на 10%','xga_reduction':.10},
    {'id':'combined','title':'Качество ударов +5% и допускаемый xG −5%','shot_quality_change':.05,'xga_reduction':.05},
]


def simulate(team_id, opponent_id=None, is_home=True, as_of=None, scenarios=None, priority='balanced',max_interventions=2,priority_strength=.15):
    b=baseline(team_id,opponent_id,is_home,as_of)
    base_points=b['probabilities']['expected_points']; alternatives=[]
    for item in scenarios if scenarios is not None else DEFAULT_SCENARIOS:
        changes={k:float(item.get(k,0)) for k in ('shot_volume_change','shot_quality_change','attack_xg_change','xga_reduction')}
        a,d=apply_changes(b['attack_xg'],b['defense_xg'],changes)
        p=goal_probabilities(a,d)
        sensitivity=[]
        for factor in (.5,1,1.5):
            varied={k:float(np.clip(v*factor,-.5,.5)) for k,v in changes.items()}
            aa,dd=apply_changes(b['attack_xg'],b['defense_xg'],varied)
            sensitivity.append({'assumption_factor':factor,'expected_points':goal_probabilities(aa,dd)['expected_points'],
                                'clipped_to_input_limits':any(abs(v*factor)>.5 for v in changes.values())})
        n=sum(v!=0 for v in changes.values())
        attacking=any(changes[k] for k in ('shot_volume_change','shot_quality_change','attack_xg_change'))
        aligns=(priority=='attack' and attacking) or (priority=='defense' and changes['xga_reduction']!=0)
        score=(p['expected_points']-base_points)*(1+priority_strength if aligns else 1.)/max(1,n)
        alternatives.append({'id':item['id'],'title':item['title'],'assumptions':changes,
            'attack_xg':a,'defense_xg':d,'probabilities':p,'delta_expected_points':p['expected_points']-base_points,
            'sensitivity':sensitivity,'interventions':n,'eligible':n<=max_interventions,'priority_score':score,
            'evidence_ids':[e['id'] for e in b['evidence']],
            'uncertainty':'Диапазон чувствительности меняет допущения; он не является доверительным интервалом эффекта тактики.'})
    alternatives.sort(key=lambda s:s['priority_score'],reverse=True)
    return clean({'team_id':team_id,'opponent_id':opponent_id,'baseline':b,'scenarios':alternatives,
        'planning':{'priority':{'balanced':'Баланс','attack':'Атака','defense':'Защита'}[priority],
                    'max_interventions':max_interventions,
                    'priority_strength':priority_strength,
                    'score_definition':'Прирост ожидаемых очков / число изменяемых показателей; множитель 1 + вес приоритета при соответствии направлению. Вес задаёт тренер, это не измеренный эффект.'},
        'limitations':['Изменения xG заданы пользователем; конкретная тактическая инструкция не гарантирует такой эффект.',
                      'Независимость голов Пуассона не учитывает счёт по ходу игры, удаления и зависимость голов.',
                      'Пенальти включены в базовый xG; при изменении редких событий база может смещаться.',
                      'При отсутствии as_of используются данные полного исторического сезона; это не предматчевый прогноз.']})
