"""Изолированный временной ML-эксперимент; рабочие модели и SQLite не записываются."""
from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import sys
import time

os.environ.setdefault('LOKY_MAX_CPU_COUNT', '2')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import joblib
import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, log_loss, precision_recall_fscore_support
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

from app.data import DB_PATH, MODEL_DIR, clean, frame, get_meta
from app.prediction import FEATURES, build_observations, chronological_split, probabilities


EXTRA = ['elo_difference', 'points_difference_3', 'xg_difference_3', 'xga_difference_3',
         'venue_xg_difference', 'venue_xga_difference', 'league_rest_days_difference',
         'opponent_elo_difference_5']
COMPACT = ['elo_difference', 'points_difference_3', 'xg_difference_3', 'xga_difference_3',
           'diff_points', 'diff_xg', 'diff_xga', *EXTRA[4:]]
FEATURE_SETS = {'original': FEATURES, 'elo': ['elo_difference'],
                'compact': COMPACT, 'augmented': [*FEATURES, *EXTRA]}
FEATURE_LABELS = {'original': 'Исходные 13 признаков', 'elo': 'Только предматчевый Elo',
                  'compact': 'Компактные 11 признаков', 'augmented': 'Расширенные 21 признак'}


def build_experiment_observations(df=None):
    """Одна строка на исходный допустимый матч; все обновления Elo после дня игр.

    Elo: старт 1500, K=20, домашняя поправка 60, делитель 400. Настройки
    фиксированы до оценки. Истории включают ранние игры, исключённые из ML.
    Поле сглаживается пятью матчами собственного более раннего общего уровня.
    Интервал — календарные дни между играми Ла Лиги, не полный отдых игрока.
    """
    df = frame() if df is None else df.copy()
    original = build_observations(df)
    eligible = set(original.match_id)
    ratings = defaultdict(lambda: 1500.)
    opponent_history = defaultdict(list)
    rows = []
    all_home = df[df.is_home == 1].sort_values(['match_date', 'kick_off', 'match_id'])
    last_rating_date = None
    for day, fixtures in all_home.groupby('match_date', sort=True):
        past = df[df.match_date < day]
        changes = defaultdict(float)
        pending_history = []
        for m in fixtures.itertuples():
            home_id, away_id = int(m.team_id), int(m.opponent_id)
            rh, ra = ratings[home_id], ratings[away_id]
            if m.match_id in eligible:
                h = past[past.team_id == home_id].sort_values(['match_date', 'kick_off', 'match_id'])
                a = past[past.team_id == away_id].sort_values(['match_date', 'kick_off', 'match_id'])
                h3, a3 = h.tail(3), a.tail(3)
                hv, av = h[h.is_home == 1], a[a.is_home == 0]
                def venue_mean(venue, overall, metric):
                    return (venue[metric].sum() + 5 * overall[metric].mean()) / (len(venue) + 5)
                rest_h = min((pd.Timestamp(day) - pd.Timestamp(h.match_date.iloc[-1])).days, 21)
                rest_a = min((pd.Timestamp(day) - pd.Timestamp(a.match_date.iloc[-1])).days, 21)
                rows.append({'match_id': int(m.match_id), 'elo_difference': (rh-ra)/400,
                    'points_difference_3': h3.points.mean()-a3.points.mean(),
                    'xg_difference_3': h3.xg.mean()-a3.xg.mean(),
                    'xga_difference_3': h3.xga.mean()-a3.xga.mean(),
                    'venue_xg_difference': venue_mean(hv,h,'xg')-venue_mean(av,a,'xg'),
                    'venue_xga_difference': venue_mean(hv,h,'xga')-venue_mean(av,a,'xga'),
                    'league_rest_days_difference': rest_h-rest_a,
                    'opponent_elo_difference_5': (np.mean(opponent_history[home_id][-5:])
                                                - np.mean(opponent_history[away_id][-5:]))/400,
                    'latest_extra_feature_date': max(h.match_date.max(), a.match_date.max(), last_rating_date),
                    'venue_history_ids': sorted(set(h.match_id.astype(int)) | set(a.match_id.astype(int)))})
            expected = 1/(1+10**((ra-rh-60)/400))
            actual = 1 if m.result == 'W' else .5 if m.result == 'D' else 0
            delta = 20*(actual-expected)
            changes[home_id] += delta
            changes[away_id] -= delta
            pending_history.extend([(home_id, ra), (away_id, rh)])
        for tid, delta in changes.items():
            ratings[tid] += delta
        for tid, value in pending_history:
            opponent_history[tid].append(value)
        last_rating_date = day
    obs = original.merge(pd.DataFrame(rows), on='match_id', validate='one_to_one')
    assert len(obs) == len(original) and obs.match_id.is_unique
    assert (obs.latest_extra_feature_date < obs.match_date).all()
    assert np.isfinite(obs[FEATURE_SETS['augmented']]).all().all()
    return obs.sort_values(['match_date', 'match_id']).reset_index(drop=True)


def expanding_splits(obs, n_splits=4, initial_fraction=.4):
    """Непересекающиеся будущие блоки, одинаковые даты никогда не разделяются."""
    dates = np.array(sorted(obs.match_date.unique()))
    start = int(len(dates)*initial_fraction)
    if start < n_splits:
        raise ValueError('Недостаточно дат для временной проверки.')
    blocks = np.array_split(dates[start:], n_splits)
    for block in blocks:
        train = np.flatnonzero((obs.match_date < block[0]).to_numpy())
        valid = np.flatnonzero(obs.match_date.isin(block).to_numpy())
        if not len(train) or not len(valid):
            raise ValueError('Пустое временное окно.')
        assert obs.iloc[train].match_date.max() < obs.iloc[valid].match_date.min()
        assert set(obs.iloc[train].target) == {0,1,2}
        yield train, valid


@dataclass(frozen=True)
class Candidate:
    id: str
    features: str
    family: str
    parameter: float = 0


def candidates():
    result = [Candidate('prior','original','prior'),
              Candidate('original_lr_0.3','original','logistic',.3),
              Candidate('original_lr_0.03','original','logistic',.03)]
    for group, values in [('elo', [.03,.3,3]), ('compact',[.03,.3,3]), ('augmented',[.03,.3])]:
        result.extend(Candidate(f'{group}_lr_{c}',group,'logistic',c) for c in values)
    result.extend([Candidate('original_forest','original','forest',4),
                   Candidate('compact_forest_3','compact','forest',3),
                   Candidate('compact_forest_4','compact','forest',4),
                   Candidate('compact_hist_10','compact','hist',10),
                   Candidate('compact_hist_30','compact','hist',30)])
    assert len(result) == 16
    return result


def make_pipeline(candidate):
    if candidate.family == 'prior':
        estimator = DummyClassifier(strategy='prior')
    elif candidate.family == 'logistic':
        estimator = LogisticRegression(C=candidate.parameter,max_iter=2000,random_state=42)
    elif candidate.family == 'forest':
        estimator = RandomForestClassifier(n_estimators=300,max_depth=int(candidate.parameter),
            min_samples_leaf=10 if candidate.features=='original' else 15,
            max_features=.8,random_state=42,n_jobs=2)
    else:
        # Раннее прекращение с произвольной внутренней выборкой отключено.
        estimator = HistGradientBoostingClassifier(max_iter=75,learning_rate=.05,
            max_leaf_nodes=3,min_samples_leaf=20,l2_regularization=candidate.parameter,
            early_stopping=False,random_state=42)
    return Pipeline([('imputer',SimpleImputer(strategy='median')),
                     ('scaler',StandardScaler()),('model',estimator)])


def predict_split(candidate, obs, train, valid):
    model = make_pipeline(candidate)
    cols = FEATURE_SETS[candidate.features]
    model.fit(obs.iloc[train][cols],obs.iloc[train].target)
    return probabilities(model,obs.iloc[valid][cols])


def metric_summary(y, p):
    y = np.asarray(y,dtype=int)
    predicted = p.argmax(axis=1)
    precision,recall,_,support = precision_recall_fscore_support(y,predicted,labels=[0,1,2],zero_division=0)
    reliability = []
    ece = []
    for label in range(3):
        error = 0.
        bins = []
        for lower,upper in zip(np.arange(0,1,.2),np.arange(.2,1.01,.2)):
            mask = (p[:,label] >= lower) & (p[:,label] < (upper if upper < .99 else 1.01))
            if mask.any():
                mean = float(p[mask,label].mean())
                frequency = float((y[mask] == label).mean())
                error += mask.mean()*abs(mean-frequency)
                bins.append({'lower':float(lower),'upper':float(upper),'n':int(mask.sum()),
                             'predicted':mean,'observed':frequency})
        ece.append(error)
        reliability.append({'class':label,'bins':bins})
    return clean({'n':len(y),'accuracy':accuracy_score(y,predicted),
        'macro_f1':f1_score(y,predicted,labels=[0,1,2],average='macro',zero_division=0),
        'log_loss':log_loss(y,p,labels=[0,1,2]),
        'brier':np.mean(np.sum((p-np.eye(3)[y])**2,axis=1)),
        'draw_precision':precision[1],'draw_recall':recall[1],'draw_support':int(support[1]),
        'draw_probability_mean':p[:,1].mean(),'draw_frequency':(y==1).mean(),
        'classwise_ece_5_bins':np.mean(ece),'calibration_bins':reliability})


def without_bins(metrics):
    return {k:v for k,v in metrics.items() if k!='calibration_bins'}


def cv_predictions(candidate, obs, splits):
    prediction = np.full((len(obs),3), np.nan)
    folds = []
    for train,valid in splits:
        p = predict_split(candidate,obs,train,valid)
        prediction[valid] = p
        folds.append(metric_summary(obs.iloc[valid].target,p))
    mask = np.isfinite(prediction).all(axis=1)
    return metric_summary(obs.loc[mask,'target'],prediction[mask]), prediction, folds


def block_difference(obs, original_p, candidate_p, block_weeks=1):
    """Парный интервал выигрыша: потери исходной модели минус кандидата.

    Перевыборка одинаковых календарных недель для обеих моделей; 2-недельный
    вариант сохраняет короткую последовательную зависимость, но не устраняет
    всю зависимость матчей клубов. Интервал не учитывает множественный поиск.
    """
    target = obs.target.to_numpy(int)
    index = np.arange(len(obs))
    ll = -np.log(original_p[index,target]) + np.log(candidate_p[index,target])
    brier = (np.sum((original_p-np.eye(3)[target])**2,axis=1)
             - np.sum((candidate_p-np.eye(3)[target])**2,axis=1))
    groups = pd.DataFrame({'week':pd.to_datetime(obs.match_date).dt.to_period('W-SUN'),
        'll':ll,'brier':brier,'count':1}).groupby('week',sort=True)[['ll','brier','count']].sum()
    values = groups.to_numpy()
    rng = np.random.default_rng(20261104+block_weeks)
    total = len(values)
    starts = rng.integers(0,total,(3000,int(np.ceil(total/block_weeks))))
    sampled = ((starts[:,:,None]+np.arange(block_weeks)) % total).reshape(3000,-1)[:,:total]
    sums = values[sampled].sum(axis=1)
    return clean({'weeks':total,'block_weeks':block_weeks,
        'log_loss_gain':ll.mean(),'log_loss_gain_interval_95':np.quantile(sums[:,0]/sums[:,2],[.025,.975]),
        'brier_gain':brier.mean(),'brier_gain_interval_95':np.quantile(sums[:,1]/sums[:,2],[.025,.975])})


def calibration_size_check(obs, outer_splits):
    checks = []
    for train,_ in outer_splits:
        training = obs.iloc[train]
        dates = sorted(training.match_date.unique())
        cut = dates[int(.75*len(dates))]
        fit = training[training.match_date<cut]
        calibration = training[training.match_date>=cut]
        counts = calibration.target.value_counts().reindex([0,1,2],fill_value=0)
        checks.append({'fit_n':len(fit),'calibration_n':len(calibration),
                       'calibration_class_counts':counts.astype(int).tolist(),
                       'sufficient':bool(len(fit)>=100 and counts.min()>=30)})
    return checks


def run(include_known_test=False):
    assets = [DB_PATH,MODEL_DIR/'outcome.joblib',MODEL_DIR/'styles.joblib']
    hashes = {p:hashlib.sha256(p.read_bytes()).hexdigest() for p in assets}
    start = time.monotonic()
    obs = build_experiment_observations()
    train,val,test = chronological_split(obs)
    development = pd.concat([train,val]).reset_index(drop=True)
    outer = list(expanding_splits(development))
    roster = candidates()
    incumbent = next(c for c in roster if c.id=='original_lr_0.3')
    print('Протокол: 16 фиксированных конфигураций; 4 внешних и 3 внутренних временных окна.',flush=True)
    print('Данные разработки:',len(development),'; известная тестовая часть:',len(test),flush=True)
    print('Параметры Elo: K=20, преимущество дома=60; начальный рейтинг=1500; без настройки.',flush=True)
    nested_p = np.full((len(development),3),np.nan)
    baseline_p = np.full_like(nested_p,np.nan)
    nested_folds = []
    calibration_checks = calibration_size_check(development,outer)
    for number,(tr,va) in enumerate(outer,1):
        history = development.iloc[tr].reset_index(drop=True)
        inner = list(expanding_splits(history,n_splits=3,initial_fraction=.5))
        scores = {c.id:cv_predictions(c,history,inner)[0]['log_loss'] for c in roster}
        winner = min(roster,key=lambda c:(scores[c.id],roster.index(c)))
        p = predict_split(winner,development,tr,va)
        reference = predict_split(incumbent,development,tr,va)
        nested_p[va] = p
        baseline_p[va] = reference
        row = {'fold':number,'train_n':len(tr),'valid_n':len(va),
            'start':development.iloc[va].match_date.min(),'end':development.iloc[va].match_date.max(),
            'selected':winner.id,'inner_log_loss':scores[winner.id],
            'candidate':without_bins(metric_summary(development.iloc[va].target,p)),
            'original':without_bins(metric_summary(development.iloc[va].target,reference))}
        nested_folds.append(row)
        print('Внешнее окно:',json.dumps(row,ensure_ascii=False),flush=True)
    mask = np.isfinite(nested_p).all(axis=1)
    evaluated = development.loc[mask].reset_index(drop=True)
    nested_metrics = metric_summary(evaluated.target,nested_p[mask])
    original_metrics = metric_summary(evaluated.target,baseline_p[mask])
    intervals = [block_difference(evaluated,baseline_p[mask],nested_p[mask],size) for size in [1,2]]
    wins = sum(f['candidate']['log_loss']<f['original']['log_loss'] for f in nested_folds)
    convincing = (original_metrics['log_loss']-nested_metrics['log_loss']>=.02 and wins>=3
        and nested_metrics['brier']<=original_metrics['brier']
        and all(i['log_loss_gain_interval_95'][0]>0 for i in intervals))
    print('Вложенная проверка:',json.dumps({'original':without_bins(original_metrics),
        'selection_procedure':without_bins(nested_metrics),'improved_folds':wins,'intervals':intervals,
        'predefined_replacement_rule_met':convincing},ensure_ascii=False),flush=True)
    print('Проверка размера калибровки:',json.dumps(calibration_checks,ensure_ascii=False),flush=True)
    assert not all(x['sufficient'] for x in calibration_checks), 'Требуется отдельный протокол калибровки.'
    leaderboard = []
    predictions = {}
    for c in roster:
        summary,p,fold_metrics = cv_predictions(c,development,outer)
        predictions[c.id] = p
        row = {'id':c.id,'family':c.family,'feature_set':FEATURE_LABELS[c.features],
               'features_n':len(FEATURE_SETS[c.features]),'metrics':without_bins(summary),
               'fold_log_loss':[f['log_loss'] for f in fold_metrics]}
        leaderboard.append(row)
    leaderboard.sort(key=lambda r:r['metrics']['log_loss'])
    final = next(c for c in roster if c.id==leaderboard[0]['id'])
    print('Сравнение фиксированных конфигураций:',json.dumps(leaderboard,ensure_ascii=False),flush=True)
    print('Конфигурация зафиксирована до повторного теста:',final.id,flush=True)
    final_p = predictions[final.id][mask]
    print('Калибровочные группы разработки:',json.dumps({'original':original_metrics['calibration_bins'],
        'nested':nested_metrics['calibration_bins'],'final':metric_summary(evaluated.target,final_p)['calibration_bins']},ensure_ascii=False),flush=True)
    final_wins = sum(a<b for a,b in zip(leaderboard[0]['fold_log_loss'],
        next(r['fold_log_loss'] for r in leaderboard if r['id']==incumbent.id)))
    convincing = convincing and original_metrics['log_loss']-leaderboard[0]['metrics']['log_loss']>=.02 and final_wins>=3
    test_results = None
    if include_known_test:
        print('Повторная проверка уже изученных 70 матчей; это НЕ новый независимый тест.',flush=True)
        test_results = {}
        final_models = {c.id:c for c in [roster[0],incumbent,
                       next(c for c in roster if c.id=='original_forest'),final]}
        for key,c in final_models.items():
            model = make_pipeline(c)
            cols = FEATURE_SETS[c.features]
            model.fit(development[cols],development.target)
            p = probabilities(model,test[cols])
            score = metric_summary(test.target,p)
            test_results[key] = score
            if key==incumbent.id:
                artifact = joblib.load(MODEL_DIR/'outcome.joblib')
                np.testing.assert_allclose(p,probabilities(artifact['model'],test[FEATURES]),rtol=0,atol=1e-12)
            if key in ['prior',incumbent.id,'original_forest']:
                saved_key = {'prior':'prior',incumbent.id:'logistic','original_forest':'forest'}[key]
                saved = get_meta('prediction')['models'][saved_key]['test']
                for metric in ['accuracy','macro_f1','log_loss']:
                    assert abs(score[metric]-saved[metric])<1e-12
        print('Результаты известного теста:',json.dumps(test_results,ensure_ascii=False),flush=True)
    for path,digest in hashes.items():
        assert hashlib.sha256(path.read_bytes()).hexdigest()==digest, 'Рабочий артефакт изменён.'
    print('Решение только по разработке:',json.dumps({'recommend_replacement':bool(convincing),
        'frozen_candidate':final.id,'production_model_replaced':False,
        'assets_unchanged':True,'elapsed_seconds':round(time.monotonic()-start,2)},ensure_ascii=False),flush=True)
    return {'leaderboard':leaderboard,'nested_folds':nested_folds,'intervals':intervals,
            'candidate':final.id,'recommend_replacement':bool(convincing),'known_test':test_results}


if __name__=='__main__':
    if hasattr(sys.stdout,'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='Временной эксперимент прогнозирования без замены рабочей модели')
    parser.add_argument('--include-known-test',action='store_true',
                        help='После фиксации конфигурации показать повторную оценку известных 70 матчей')
    args = parser.parse_args()
    with threadpool_limits(limits=2):
        run(include_known_test=args.include_known_test)
