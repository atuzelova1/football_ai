"""Короткие научные и интеграционные проверки на подготовленном реальном сезоне."""
import json
import urllib.request

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.data import frame,query,get_meta,MODEL_DIR
from app.processing import progressive,zone
from app.prediction import build_observations,chronological_split,FEATURES
from app.simulator import goal_probabilities,apply_changes


@pytest.fixture(scope='session')
def df():
    return frame()


@pytest.fixture
def client(monkeypatch):
    def network_forbidden(*args,**kwargs):
        raise AssertionError('API не должен обращаться в сеть после подготовки данных')
    monkeypatch.setattr(urllib.request,'urlopen',network_forbidden)
    with TestClient(app) as c:
        yield c


def test_metrics_and_score_reconciliation(df):
    assert len(df)==760 and df.team_id.nunique()==20 and df.match_id.nunique()==380
    assert (df.groupby('team_id').size()==38).all()
    assert np.allclose(df.xgd,df.xg-df.xga)
    assert np.allclose(df.goals_for,df.shot_goals+df.own_goals_for)
    assert np.allclose(df.points_dropped,3-df.points)
    assert (df.points==np.where(df.goals_for>df.goals_against,3,np.where(df.goals_for==df.goals_against,1,0))).all()
    for mid,g in df.groupby('match_id'):
        a,b=g.iloc[0],g.iloc[1]
        assert a.team_id==b.opponent_id and a.opponent_id==b.team_id
        assert a.goals_for==b.goals_against and a.xg==pytest.approx(b.xga)
        assert a.pass_share+b.pass_share==pytest.approx(1)
    shots=query('SELECT match_id,team_id,COUNT(*) shots,SUM(xg) xg,SUM(goal) goals FROM shots GROUP BY match_id,team_id')
    index=df.set_index(['match_id','team_id'])
    for s in shots:
        row=index.loc[(s['match_id'],s['team_id'])]
        assert row.shots==s['shots'] and row.shot_goals==s['goals']
        assert row.xg==pytest.approx(s['xg'])
        assert row.shot_quality==pytest.approx(s['xg']/s['shots'])
    no_shots=df[df.shots==0]
    assert no_shots.shot_quality.isna().all() and no_shots.conversion.isna().all()
    coverage=get_meta('coverage')
    assert coverage['score_reconciled_matches']==380
    assert df.own_goals_for.sum()==coverage['quality_counts']['own_goal_against_events']
    assert coverage['shot_xg_completeness']==1


def test_operational_definitions():
    assert progressive([60,40],[80,40])
    assert not progressive([60,40],[65,40])
    assert not progressive([100,40],[90,40])
    assert zone([110,40])=='central_box' and zone([110,5])=='wide_box'
    assert zone([90,40])=='outside_box'


def test_chronology_and_future_perturbation(df):
    obs=build_observations(df); tr,va,te=chronological_split(obs)
    assert obs.match_id.is_unique
    assert (obs.latest_feature_date<obs.match_date).all()
    assert tr.match_date.max()<va.match_date.min()<te.match_date.min()
    assert va.match_date.max()<te.match_date.min()
    assert not set(tr.match_id)&set(te.match_id)
    target=te.iloc[0]; altered=df.copy()
    altered.loc[altered.match_date>=target.match_date,['xg','xga','goals_for','points','shots']]=999
    rebuilt=build_observations(altered)
    same=rebuilt[rebuilt.match_id==target.match_id].iloc[0]
    np.testing.assert_allclose(target[FEATURES].astype(float),same[FEATURES].astype(float))
    for r in obs.itertuples():
        source=df[df.match_id.isin(r.home_history_ids+r.away_history_ids)]
        assert (source.match_date<r.match_date).all()


def test_model_probabilities_and_perspective(client):
    m=client.get('/api/prediction/metrics').json()
    mid=m['splits']['test']['match_ids'][0]
    teams=query('SELECT home_id,away_id FROM matches WHERE match_id=?',(mid,))[0]
    outputs=[]
    for tid in teams.values():
        response=client.post('/api/prediction',json={'team_id':tid,'match_id':mid})
        assert response.status_code==200,response.text
        p=response.json()['probabilities']; assert sum(p.values())==pytest.approx(1)
        assert all(0<=v<=1 for v in p.values()); outputs.append(p)
    assert outputs[0]['win']==pytest.approx(outputs[1]['loss'])
    assert outputs[0]['draw']==pytest.approx(outputs[1]['draw'])
    assert client.post('/api/prediction',json={'team_id':teams['home_id'],'match_id':m['splits']['train']['match_ids'][0]}).status_code==400
    assert set(m['models'])=={'prior','logistic','forest'}
    assert m['selected_model']==min(m['models'],key=lambda k:m['models'][k]['validation']['log_loss'])
    for model in m['models'].values():
        assert sum(sum(row) for row in model['test']['confusion_matrix']['values'])==m['splits']['test']['n']
        assert np.isfinite(model['test']['log_loss'])


def test_saved_preprocessing_was_fitted_without_test_matches(df):
    import joblib
    artifact=joblib.load(MODEL_DIR/'outcome.joblib')
    obs=build_observations(df);train,val,test=chronological_split(obs)
    fitting=obs[obs.match_id.isin(set(train.match_id)|set(val.match_id))]
    pipeline=artifact['model'];imputed=pipeline.named_steps['imputer'].transform(fitting[FEATURES])
    scaler=pipeline.named_steps['scaler']
    assert scaler.n_samples_seen_==len(train)+len(val)
    np.testing.assert_allclose(scaler.mean_,imputed.mean(axis=0),rtol=1e-12,atol=1e-12)
    assert not set(fitting.match_id)&set(test.match_id)


@pytest.mark.parametrize('attack,defense',[(0,0),(1.2,1.2),(.01,20),(20,.01),(20,20)])
def test_poisson_numerics(attack,defense):
    p=goal_probabilities(attack,defense)
    assert p['win']+p['draw']+p['loss']==pytest.approx(1)
    assert p['expected_points']==pytest.approx(3*p['win']+p['draw'])
    assert p['omitted_tail']<1e-9
    if attack==defense:
        assert p['win']==pytest.approx(p['loss'])
    if attack==defense==0:
        assert p['draw']==1 and p['expected_points']==1


def test_scenario_baseline_and_sensitivity(client):
    teams=client.get('/api/clubs').json(); tid=teams[0]['team_id']; oid=teams[1]['team_id']
    response=client.post('/api/simulation',json={'team_id':tid,'opponent_id':oid,'scenarios':[
        {'id':'same','title':'Без изменений'},
        {'id':'limit','title':'Проверка предельного допустимого изменения','shot_volume_change':.5,'shot_quality_change':.5,'xga_reduction':.5}]})
    assert response.status_code==200,response.text
    r=response.json(); same=next(s for s in r['scenarios'] if s['id']=='same')
    assert same['probabilities']==r['baseline']['probabilities'] and same['delta_expected_points']==0
    a,d=apply_changes(1,1,{'shot_volume_change':.1,'shot_quality_change':.1})
    assert a==pytest.approx(1.21) and d==1
    for s in r['scenarios']:
        assert sum(s['probabilities'][k] for k in ['win','draw','loss'])==pytest.approx(1)
    invalid={'team_id':tid,'scenarios':[{'id':'bad','title':'Дублирование','attack_xg_change':.1,'shot_volume_change':.1}]}
    assert client.post('/api/simulation',json=invalid).status_code==422
    assert client.post('/api/simulation',json={'team_id':tid,'opponent_id':tid}).status_code==422
    assert client.post('/api/simulation',json={'team_id':tid,'as_of':'2015-08-01'}).status_code==400


def test_clustering_evaluation_and_units():
    s=get_meta('styles')
    assert len(s['candidates'])==4 and 2<=s['selected_k']<=5
    assert -1<=s['silhouette']<=1
    assert sorted(t for c in s['clusters'] for t in c['team_ids'])==sorted(r['team_id'] for r in query('SELECT team_id FROM clubs'))
    assert s['alternative_block_evaluation']['profiles']==120
    assert len(s['alternative_block_evaluation']['candidates'])==4
    if not s['minimum_cluster_constraint_met']:
        assert 'менее трёх' in s['reliability_warning']


@pytest.mark.parametrize('team_id',[r['team_id'] for r in query('SELECT team_id FROM clubs')])
def test_every_club_all_modules_and_evidence(client,df,team_id):
    own=df[df.team_id==team_id]; opponent=int(own.opponent_id.iloc[-1]); ids=set(own.match_id.astype(int))
    for path in ['overview','research','matches','opponents']:
        response=client.get(f'/api/clubs/{team_id}/{path}')
        assert response.status_code==200,response.text
        out=response.json()
        if path=='matches':
            assert len(out)==38 and {r['team_id'] for r in out}=={team_id}
        else:
            assert out['team']['team_id']==team_id
        if path=='research':
            assert len(out['hypotheses'])==4
            for h in out['hypotheses']:
                assert 0<=h['p_value']<=h['p_adjusted']<=1
                ci=h['confidence_interval']; assert ci['lower']<=ci['upper']
                assert h['significant']==(h['p_adjusted']<.05)
    response=client.get(f'/api/matches/{int(own.match_id.iloc[0])}/analysis?team_id={team_id}')
    assert response.status_code==200,response.text
    response=client.post('/api/prediction',json={'team_id':team_id,'opponent_id':opponent})
    assert response.status_code==200,response.text
    response=client.post('/api/advisor',json={'team_id':team_id,'opponent_id':opponent,'max_interventions':1})
    assert response.status_code==200,response.text
    out=response.json(); lookup={e['id']:e for e in out['evidence']}
    assert sum(r['interventions'] for r in out['recommendations'] if r['selected_for_testing'])<=1
    for rec in out['recommendations']:
        assert rec['evidence_ids'] and rec['experiment'] and rec['evaluation_plan']
        assert all(e in lookup for e in rec['evidence_ids'])
        for e in rec['supporting_metrics']:
            assert e['team_id']==team_id and set(e['match_ids'])<=ids and e['match_ids']
        weights=out['ranking']['weights']
        assert rec['score']==pytest.approx(sum(weights[k]*v for k,v in rec['score_components'].items()))
    baseline=out['simulation']['baseline']; assert baseline['team']['team_id']==team_id
    assert baseline['opponent']['team_id']==opponent
    for sc in out['simulation']['scenarios']:
        if sc['id'] in ('creation','quality','defense','combined'):
            assert sc['delta_expected_points']>=0


def test_api_meta_and_invalid_entities(client):
    assert client.get('/api/health').json()['ready']
    assert client.get('/api/meta').json()['coverage']['matches']==380
    assert len(client.get('/api/meta').json()['modules'])==6
    assert client.get('/api/clubs/999999/overview').status_code==400
    assert client.get('/api/matches/999999/analysis?team_id=220').status_code==400
    assert client.get('/openapi.json').status_code==200


def test_visual_series_reconcile_with_events(client):
    clubs=client.get('/api/clubs').json();tid=clubs[0]['team_id'];oid=clubs[1]['team_id']
    matches=client.get(f'/api/clubs/{tid}/matches').json()
    data=client.get(f'/api/matches/{matches[0]["match_id"]}/analysis?team_id={tid}').json()
    own=next(t for t in data['teams'] if t['team_id']==tid)
    assert data['visuals']['xg_timeline'][-1]['team_xg']==pytest.approx(own['xg'])
    assert sum(b['team'] for b in data['visuals']['quality_distribution'])==own['shots']
    assert sum(p['attempts'] for p in data['visuals']['passing_matrix'])<=own['passes']
    assert all(s['player_name'] for s in data['shots'])
    styles=client.get(f'/api/clubs/{tid}/opponents?opponent_id={oid}').json()
    assert len(styles['visuals']['team_profiles'])==20
    assert all(0<=row['team']<=100 and 0<=row['opponent']<=100 for row in styles['visuals']['radar'])


def test_custom_scenario_reaches_advisor_and_changes_effect(client):
    clubs=client.get('/api/clubs').json();base={'team_id':clubs[0]['team_id'],'opponent_id':clubs[1]['team_id']}
    a=client.post('/api/advisor',json={**base,'scenario':{'id':'quality','title':'Качество ударов','shot_quality_change':.25}})
    assert a.status_code==200,a.text
    out=a.json();rec=next(r for r in out['recommendations'] if r['scenario_id']=='quality')
    assert out['selected_scenario_id']=='quality' and rec['scenario_assumptions']['shot_quality_change']==.25
    direct=client.post('/api/simulation',json={**base,'scenarios':[{'id':'quality','title':'Качество ударов','shot_quality_change':.25}]}).json()
    assert rec['modeled_delta_expected_points']==pytest.approx(direct['scenarios'][0]['delta_expected_points'])
    custom=client.post('/api/advisor',json={**base,'scenario':{'id':'custom','title':'Свой сценарий','attack_xg_change':.15,'xga_reduction':.05}})
    assert custom.status_code==200,custom.text
    assert custom.json()['selected_scenario_id']=='custom'
    assert any(r['scenario_id']=='custom' for r in custom.json()['recommendations'])
