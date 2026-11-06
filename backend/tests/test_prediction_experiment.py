"""Проверки хронологии новых признаков и изоляции ML-эксперимента."""
import json
import numpy as np
import pandas as pd

from app.data import frame
from app.prediction import build_observations, chronological_split
from scripts.experiment_prediction import (FEATURE_SETS, build_experiment_observations,
    calibration_size_check, candidates, expanding_splits, make_pipeline, metric_summary, predict_split)


def test_new_features_ignore_current_future_and_same_day_events():
    df = frame()
    before = build_experiment_observations(df)
    target = before.iloc[170]
    altered = df.copy()
    changed = altered.match_date >= target.match_date
    altered.loc[changed,['xg','xga','goals_for','goals_against','points','shots']] = 999
    altered.loc[changed,'result'] = 'D'
    after = build_experiment_observations(altered)
    cols = FEATURE_SETS['augmented']
    np.testing.assert_allclose(before.loc[before.match_id==target.match_id,cols],
                              after.loc[after.match_id==target.match_id,cols],atol=0,rtol=0)
    assert (before.latest_extra_feature_date < before.match_date).all()
    assert set(before.match_id)==set(build_observations(df).match_id)
    for r in before.itertuples():
        assert (df[df.match_id.isin(r.venue_history_ids)].match_date < r.match_date).all()
    # Перестановка строк внутри дня не должна изменять историю Elo.
    shuffled = build_experiment_observations(df.sample(frac=1,random_state=8))
    np.testing.assert_allclose(before[cols],shuffled[cols],atol=0,rtol=0)


def test_expanding_validation_keeps_dates_matches_and_known_test_separate():
    obs = build_experiment_observations()
    train,val,test = chronological_split(obs)
    development = pd.concat([train,val]).reset_index(drop=True)
    seen = set()
    for tr,va in expanding_splits(development):
        a,b = development.iloc[tr],development.iloc[va]
        assert a.match_date.max() < b.match_date.min() < test.match_date.min()
        assert not set(a.match_id)&set(b.match_id)
        assert not seen & set(b.match_id)
        seen.update(b.match_id)
        for inner_train,inner_val in expanding_splits(a.reset_index(drop=True),3,.5):
            assert a.iloc[inner_train].match_date.max() < a.iloc[inner_val].match_date.min()
    assert len(seen)==170 and not seen & set(test.match_id)
    checks = calibration_size_check(development,list(expanding_splits(development)))
    assert not all(row['sufficient'] for row in checks)
    assert json.loads(json.dumps(checks)) == checks


def test_experiment_preprocessing_and_probability_calculations():
    obs = build_experiment_observations()
    candidate = next(c for c in candidates() if c.id=='compact_lr_0.3')
    tr,va = next(expanding_splits(obs))
    cols = FEATURE_SETS[candidate.features]
    pipeline = make_pipeline(candidate)
    pipeline.fit(obs.iloc[tr][cols],obs.iloc[tr].target)
    assert pipeline.named_steps['scaler'].n_samples_seen_==len(tr)
    np.testing.assert_allclose(pipeline.named_steps['scaler'].mean_,obs.iloc[tr][cols].mean(),atol=1e-12)
    p = predict_split(candidate,obs,tr,va)
    np.testing.assert_allclose(p.sum(axis=1),1,atol=1e-12)
    assert np.isfinite(p).all() and (p>=0).all() and (p<=1).all()
    scores = metric_summary(obs.iloc[va].target,p)
    assert scores['n']==len(va) and 0<=scores['brier']<=2
    assert 0<=scores['draw_recall']<=1 and 0<=scores['classwise_ece_5_bins']<=1
