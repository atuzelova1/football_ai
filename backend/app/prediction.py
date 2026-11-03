"""Одна строка на матч: прогноз исхода хозяев, затем перевод в перспективу клуба."""
from __future__ import annotations

import joblib
import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_recall_fscore_support, confusion_matrix, log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.data import MODEL_DIR, frame, query, club, clean, connection, put_meta, get_meta, METRIC_LABELS

HISTORY_METRICS=['goals_for','goals_against','xg','xga','points','shots','shots_against',
                 'shot_quality','pass_accuracy','pass_share','progressive_passes','dangerous_against']
FEATURES=['diff_'+m for m in HISTORY_METRICS]+['total_attack_xg']
CLASS_LABELS=['Поражение','Ничья','Победа']
MODEL_NAMES={'prior':'Априорные частоты классов','logistic':'Логистическая регрессия','forest':'Случайный лес'}


def historical_profile(df, team_id, before):
    # Строго раньше календарной даты: даже другой матч в тот же день не используется.
    past=df[(df.team_id==team_id)&(df.match_date<str(before))].sort_values(['match_date','kick_off','match_id']).tail(5)
    if len(past)<3:
        return None
    return {'values':past[HISTORY_METRICS].mean(),
            'match_ids':past.match_id.astype(int).tolist(),'latest_date':past.match_date.max(),'n':len(past)}


def features_from_profiles(home, away):
    vals={'diff_'+m:float(home['values'][m]-away['values'][m]) for m in HISTORY_METRICS}
    vals['total_attack_xg']=float(home['values']['xg']+away['values']['xg'])
    return vals


def build_observations(df=None):
    df=frame() if df is None else df
    rows=[]
    for m in df[df.is_home==1].itertuples():
        h=historical_profile(df,m.team_id,m.match_date); a=historical_profile(df,m.opponent_id,m.match_date)
        if h is None or a is None:
            continue
        rows.append({'match_id':int(m.match_id),'match_date':m.match_date,'home_id':int(m.team_id),
                     'away_id':int(m.opponent_id),'target':2 if m.result=='W' else 1 if m.result=='D' else 0,
                     'latest_feature_date':max(h['latest_date'],a['latest_date']),
                     'home_history_ids':h['match_ids'],'away_history_ids':a['match_ids'],
                     **features_from_profiles(h,a)})
    return pd.DataFrame(rows).sort_values(['match_date','match_id']).reset_index(drop=True)


def chronological_split(obs):
    dates=sorted(obs.match_date.unique()); first=dates[int(len(dates)*.60)]; second=dates[int(len(dates)*.80)]
    train=obs[obs.match_date<first]; val=obs[(obs.match_date>=first)&(obs.match_date<second)]; test=obs[obs.match_date>=second]
    assert train.match_date.max()<val.match_date.min() and val.match_date.max()<test.match_date.min()
    assert obs.match_id.is_unique and (obs.latest_feature_date<obs.match_date).all()
    return train,val,test


def probabilities(model,x):
    raw=model.predict_proba(x); p=np.zeros((len(x),3))
    for i,c in enumerate(model.classes_):
        p[:,int(c)]=raw[:,i]
    return np.clip(p,1e-12,1)/np.clip(p,1e-12,1).sum(axis=1,keepdims=True)


def evaluate(y,p):
    y=np.array(y); pred=p.argmax(axis=1)
    pr,re,f,s=precision_recall_fscore_support(y,pred,labels=[0,1,2],zero_division=0)
    calibration=[]
    for label in range(3):
        bins=[]
        for lo,hi in zip(np.arange(0,1,.2),np.arange(.2,1.01,.2)):
            mask=(p[:,label]>=lo)&(p[:,label]<(hi if hi<.99 else 1.01))
            if mask.any():
                bins.append({'lower':lo,'upper':hi,'n':int(mask.sum()),
                             'predicted':float(p[mask,label].mean()),'observed':float((y[mask]==label).mean())})
        calibration.append({'class_label':CLASS_LABELS[label],'bins':bins})
    rng=np.random.default_rng(42); scores=[]
    for _ in range(700):
        idx=rng.integers(0,len(y),len(y)); scores.append(float((pred[idx]==y[idx]).mean()))
    return clean({'n':len(y),'accuracy':accuracy_score(y,pred),'macro_f1':f1_score(y,pred,labels=[0,1,2],average='macro',zero_division=0),
        'log_loss':log_loss(y,p,labels=[0,1,2]),'brier_multiclass':np.mean(np.sum((p-np.eye(3)[y])**2,axis=1)),
        'brier_definition':'Средняя сумма квадратов ошибок трёх вероятностей; диапазон 0..2.',
        'accuracy_interval_95':np.quantile(scores,[.025,.975]),
        'per_class':[{'label':CLASS_LABELS[i],'precision':pr[i],'recall':re[i],'f1':f[i],'support':int(s[i])} for i in range(3)],
        'confusion_matrix':{'labels':CLASS_LABELS,'rows':'Фактический исход хозяев','columns':'Предсказанный исход хозяев',
                            'values':confusion_matrix(y,pred,labels=[0,1,2]).tolist()},'calibration':calibration})


def make_model(name):
    estimator={'prior':lambda:DummyClassifier(strategy='prior'),
        'logistic':lambda:LogisticRegression(C=.3,max_iter=2000,random_state=42),
        'forest':lambda:RandomForestClassifier(n_estimators=300,max_depth=4,min_samples_leaf=10,
                                               max_features=.8,random_state=42,n_jobs=2)}[name]()
    return Pipeline([('imputer',SimpleImputer(strategy='median')),('scaler',StandardScaler()),('model',estimator)])


def train_models():
    obs=build_observations(); train,val,test=chronological_split(obs)
    results={}; validation_models={}
    for name in MODEL_NAMES:
        model=make_model(name); model.fit(train[FEATURES],train.target)
        results[name]={'name':MODEL_NAMES[name],'validation':evaluate(val.target,probabilities(model,val[FEATURES]))}
        validation_models[name]=model
    # Критерий выбирается до просмотра теста; тест не участвует в подборе.
    selected=min(results,key=lambda k:results[k]['validation']['log_loss'])
    fit=pd.concat([train,val]); final=None
    for name in MODEL_NAMES:
        model=make_model(name); model.fit(fit[FEATURES],fit.target)
        results[name]['test']=evaluate(test.target,probabilities(model,test[FEATURES]))
        if name==selected:
            final=model
    estimator=final.named_steps['model']
    if hasattr(estimator,'coef_'):
        importance=np.abs(estimator.coef_).mean(axis=0); method='Средний модуль стандартизованных коэффициентов; не причинные эффекты.'
    elif hasattr(estimator,'feature_importances_'):
        importance=estimator.feature_importances_; method='Важность по уменьшению неоднородности; смещена при связанных признаках, не причинный эффект.'
    else:
        importance=np.zeros(len(FEATURES)); method='Базовая модель использует только частоты классов; важность признаков отсутствует.'
    important=[{'feature':FEATURES[i],
                'label':('Разница последних пяти матчей: '+METRIC_LABELS.get(FEATURES[i][5:],FEATURES[i][5:])) if FEATURES[i].startswith('diff_') else 'Сумма исторического xG атак',
                'importance':float(importance[i])} for i in np.argsort(importance)[::-1][:8] if importance[i]>0]
    ranges={name:{'n':len(g),'start':g.match_date.min(),'end':g.match_date.max(),
                       'match_ids':g.match_id.astype(int).tolist()} for name,g in [('train',train),('validation',val),('test',test)]}
    chosen=results[selected]['test']; base=results['prior']['test']
    metrics=clean({'selected_model':selected,'selected_model_name':MODEL_NAMES[selected],
        'selection_rule':'Минимальный log loss на будущей валидации. Затем переобучение на train+validation; однократная оценка всех моделей на test.',
        'observation_unit':'Один матч, исход хозяев; ответ переводится в перспективу выбранного клуба.',
        'splits':ranges,'fit_end':fit.match_date.max(),'eligible_matches':len(obs),
        'excluded_early_matches':380-len(obs),'history_window':5,'minimum_history':3,
        'models':results,'important_features':important,'importance_method':method,
        'test_comparison':{'log_loss_improvement_over_prior':base['log_loss']-chosen['log_loss'],
                           'accuracy_improvement_over_prior':chosen['accuracy']-base['accuracy'],
                           'interpretation':'Преимущество над базой по тестовому log loss наблюдается.' if chosen['log_loss']<base['log_loss'] else 'Преимущество над базой по тестовому log loss не подтверждено.'},
        'measured':'Результаты и события завершённых матчей; вероятности — вывод обученного классификатора.',
        'leakage_prevention':['Признаки строятся только по датам строго раньше матча; текущие события не включаются.',
            'Одна строка на встречу; разбиение по датам не разделяет команды одного матча.',
            'Imputer и StandardScaler обучаются внутри pipeline только на обучающей части.',
            'Итоговые таблица, кластеры полного сезона и текущее xG не входят в признаки.',
            'Для каждого тестового матча доступны результаты завершённых предыдущих тестовых матчей: последовательная предматчевая оценка.'],
        'limitations':['Один исторический сезон и небольшая тестовая выборка; это не сервис прогнозов на 2026 год.',
            'Классы — исход хозяев при оценке; метрики точности симметричны перспективе, поклассовые метрики относятся к хозяевам.',
            'Бутстрэп точности по матчам не учитывает зависимость встреч одной команды.',
            'Калибровка показана диагностически; дополнительная калибровка не подбиралась на тесте.',
            'Травмы, составы, удаления и изменения тренера заранее не моделируются.']})
    artifact={'model':final,'features':FEATURES,'metrics':metrics,
              'test_observations':test.to_dict('records')}
    joblib.dump(artifact,MODEL_DIR/'outcome.joblib',compress=3)
    with connection(readonly=False) as conn:
        put_meta(conn,'prediction',metrics); conn.commit()
    print(f'Выбрана модель: {MODEL_NAMES[selected]}; test n={len(test)}; accuracy={chosen["accuracy"]:.4f}; macro F1={chosen["macro_f1"]:.4f}; log loss={chosen["log_loss"]:.4f}',flush=True)
    return metrics


def predict(team_id,opponent_id=None,is_home=True,match_id=None,as_of=None):
    team=club(team_id); artifact=joblib.load(MODEL_DIR/'outcome.joblib'); metrics=artifact['metrics']
    if match_id is not None:
        rows=[r for r in artifact['test_observations'] if r['match_id']==match_id]
        if not rows:
            raise ValueError('Историческая предматчевая оценка доступна только для нетронутой тестовой части. Список ID: /api/prediction/metrics.')
        row=rows[0]
        if team_id not in (row['home_id'],row['away_id']):
            raise ValueError('Выбранный клуб не участвовал в этом матче.')
        home=team_id==row['home_id']; opp_id=row['away_id'] if home else row['home_id']
        if opponent_id is not None and opponent_id!=opp_id:
            raise ValueError('Соперник не соответствует историческому матчу.')
        context={'mode':'Историческая предматчевая оценка на тестовой части','match_id':match_id,
                 'match_date':row['match_date'],'is_home':home,'opponent':club(opp_id),
                 'feature_match_ids':sorted(row['home_history_ids']+row['away_history_ids']),
                 'latest_feature_date':row['latest_feature_date']}
    else:
        if opponent_id is None or opponent_id==team_id:
            raise ValueError('Для гипотетического анализа выберите другой клуб-соперник.')
        df=frame(); cutoff=str(as_of) if as_of else (pd.Timestamp(df.match_date.max())+pd.Timedelta(days=1)).date().isoformat()
        if cutoff<=metrics['fit_end']:
            raise ValueError('Дата гипотетического анализа должна быть позже последней даты обучения модели.')
        h_id=team_id if is_home else opponent_id; a_id=opponent_id if is_home else team_id
        h=historical_profile(df,h_id,cutoff); a=historical_profile(df,a_id,cutoff)
        if h is None or a is None:
            raise ValueError('Недостаточно исторических матчей для признаков.')
        row=features_from_profiles(h,a); home=is_home
        context={'mode':'Гипотетическое сравнение по историческому сезону 2015/2016','match_id':None,
                 'match_date':None,'as_of':cutoff,'is_home':home,'opponent':club(opponent_id),
                 'feature_match_ids':sorted(h['match_ids']+a['match_ids']),
                 'latest_feature_date':max(h['latest_date'],a['latest_date'])}
    p=probabilities(artifact['model'],pd.DataFrame([{k:row[k] for k in FEATURES}]))[0]
    return clean({'team':team,'context':context,'probabilities':{'win':p[2] if home else p[0],
        'draw':p[1],'loss':p[0] if home else p[2]},'model_name':metrics['selected_model_name'],
        'evaluation':metrics['models'][metrics['selected_model']]['test'],
        'important_features':metrics['important_features'],'features':{k:row[k] for k in FEATURES},
        'measured':metrics['measured'],'limitations':metrics['limitations']})
