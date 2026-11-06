"""Реальные основания и только тестовый mock внешнего провайдера."""
import json
import time
from datetime import date

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app import llm
from app.coaching import build_context, coaching_brief
from app.schemas import BriefRequest


BODY={'team_id':360,'opponent_id':220,'is_home':True,'match_id':3825886,
      'historical_match_id':3825886,'as_of':'2016-04-23',
      'scenario':{'id':'defense','title':'Защита центра','xga_reduction':.1}}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY',raising=False)
    llm._cache.clear();llm._answers.clear();llm._calls.clear()
    with TestClient(app,base_url='http://127.0.0.1:8000',client=('127.0.0.1',50000)) as c:
        yield c


def draft(evidence_id='team:360:before:2016-04-23:xga'):
    return {'main_conclusion':'Допущенные моменты требуют отдельного разбора. Рассмотрите защиту центральных зон.',
        'recommendation':'Проверить согласованную страховку опорного игрока и центральных защитников.',
        'unverified':True,'why':[{'text':'Наблюдаемая оборонительная нагрузка выше ориентира остальных клубов.',
                                'evidence_ids':[evidence_id]}],
        'alternatives':[{'text':'Сравнить с экспериментом по выбору более качественных ударных позиций.',
                         'evidence_ids':['team:360:before:2016-04-23:shot_quality']}],
        'risks':['Усиление центра может открыть фланги.'],
        'evaluation_plan':['Отслеживать центральный допущенный xG и доступные сопернику фланговые атаки.'],
        'missing_evidence':['Нужен ручной видеоразбор; трекинг недоступен.']}


@pytest.mark.parametrize('team_id,opponent_id',[(217,220),(220,217),(212,220),(360,220)])
def test_real_context_and_brief_keep_entities_and_evidence(team_id,opponent_id):
    body=BriefRequest(team_id=team_id,opponent_id=opponent_id)
    context=build_context(body)
    assert context['team']['team_id']==team_id and context['opponent']['team_id']==opponent_id
    assert len(json.dumps(llm.provider_context(context),ensure_ascii=False))<=26000
    known={e['id'] for e in context['evidence']}
    assert all(set(r['evidence_ids'])<=known for r in context['recommendations'])
    for rec in context['recommendations']:
        brief=coaching_brief(body.model_copy(update={'recommendation_id':rec['id']}))
        assert brief['recommendation']['id']==rec['id']
        assert set(e['id'] for e in brief['evidence'])==set(rec['evidence_ids'])
        assert all(e['team_id']==team_id for e in brief['evidence'])
        assert brief['scenario']['delta_expected_points']==pytest.approx(rec['modeled_delta_expected_points'])


def test_historical_scope_excludes_future_from_diagnosis_and_examples():
    body=BriefRequest(**BODY)
    context=build_context(body)
    assert context['ml']['context']['latest_feature_date']<'2016-04-23'
    assert context['simulation']['baseline']['sample_size']==17
    assert context['simulation']['baseline']['probabilities']['expected_points']==pytest.approx(1.3119546231474017)
    assert 'до 2016-04-23' in context['scopes']['diagnosis']
    assert context['hypotheses']==[]
    assert all(m['match_date']<'2016-04-23' for m in context['observed_match_examples'])
    from app.data import frame
    dates=frame().drop_duplicates('match_id').set_index('match_id').match_date
    assert all(dates.loc[mid]<'2016-04-23' for e in context['evidence'] for mid in e['match_ids'])
    assert len(context['observed_match_examples'])<=3
    with pytest.raises(ValueError):build_context(body.model_copy(update={'opponent_id':217}))
    with pytest.raises(ValueError):build_context(body.model_copy(update={'as_of':date(2016,4,22)}))


def test_no_key_fallback_and_local_only_budget_boundary(client,monkeypatch):
    monkeypatch.setattr(llm,'request_provider',lambda *args:pytest.fail('Не должно быть внешнего запроса'))
    assert client.get('/api/advisor/ai/status').json()['available'] is False
    r=client.post('/api/advisor/ai',json=BODY,headers={'X-Football-AI':'1'})
    assert r.status_code==503 and 'без ключа' in r.json()['detail']
    assert client.post('/api/coaching/brief',json=BODY).status_code==200
    assert client.post('/api/advisor/ai',json=BODY).status_code==403
    assert client.post('/api/advisor/ai',json=BODY,headers={'X-Football-AI':'1','Origin':'https://example.com'}).status_code==403
    with TestClient(app,base_url='http://127.0.0.1:8000',client=('198.51.100.1',50000)) as remote:
        assert remote.post('/api/advisor/ai',json=BODY,headers={'X-Football-AI':'1'}).status_code==403


def test_real_provider_contract_via_http_mock_followup_and_cache(client,monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','test-only-key')
    monkeypatch.setenv('OPENAI_MODEL','gpt-5-mini')
    requests=[]
    def handler(request):
        payload=json.loads(request.content);requests.append(payload)
        assert str(request.url)=='https://api.openai.com/v1/responses'
        assert payload['store'] is False and 'tools' not in payload
        assert payload['text']['format']['strict'] is True
        assert 'test-only-key' not in json.dumps(payload)
        return httpx2.Response(200,json={'status':'completed','output':[{'type':'message','content':[
            {'type':'output_text','text':json.dumps(draft(),ensure_ascii=False)}]}]})
    real_client=httpx2.Client
    monkeypatch.setattr(llm,'_http_client',lambda:real_client(transport=httpx2.MockTransport(handler)))
    headers={'X-Football-AI':'1'}
    a=client.post('/api/advisor/ai',json=BODY,headers=headers)
    assert a.status_code==200,a.text
    output=a.json();assert output['scenario']['delta_expected_points']==pytest.approx(.09951130347766224)
    repeated=client.post('/api/advisor/ai',json=BODY,headers=headers)
    assert repeated.status_code==200 and repeated.json()['cached'] and len(requests)==1
    follow=client.post('/api/advisor/ai',json={**BODY,'question':'Какие риски у этого решения?',
        'previous_analysis_id':output['analysis_id']},headers=headers)
    assert follow.status_code==200 and len(requests)==2
    assert len(json.loads(requests[-1]['input'][0]['content'])['recent_conversation'])==1
    wrong=client.post('/api/advisor/ai',json={**BODY,'team_id':217,'opponent_id':220,
        'previous_analysis_id':output['analysis_id']},headers=headers)
    assert wrong.status_code==400


@pytest.mark.parametrize('bad', ['unknown_evidence','invented_number'])
def test_unverified_provider_claims_are_rejected(client,monkeypatch,bad):
    monkeypatch.setenv('OPENAI_API_KEY','test-only-key')
    answer=draft('team:999:season:xga' if bad=='unknown_evidence' else 'team:360:season:xga')
    if bad=='invented_number':answer['recommendation']='Улучшение гарантирует 99 процентов побед.'
    def provider(*args):
        try:return llm.AnalysisDraft.model_validate(answer)
        except ValueError:raise llm.HTTPException(502,'Неподтверждённый ответ')
    monkeypatch.setattr(llm,'request_provider',provider)
    response=client.post('/api/advisor/ai',json=BODY,headers={'X-Football-AI':'1'})
    assert response.status_code==502 and not llm._answers


def test_rate_limit_and_secret_in_question_block_provider(client,monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','test-only-key')
    monkeypatch.setattr(llm,'request_provider',lambda *args:pytest.fail('Запрос должен блокироваться'))
    secret=client.post('/api/advisor/ai',json={**BODY,'question':'api_key=do-not-send-this-secret'},headers={'X-Football-AI':'1'})
    assert secret.status_code==422
    llm._calls.extend([time.monotonic()]*6)
    response=client.post('/api/advisor/ai',json=BODY,headers={'X-Football-AI':'1'})
    assert response.status_code==429


def test_rayo_direct_defensive_evidence_outranks_fragile_cluster():
    from app.advisor import advise
    from app.data import frame
    answer=advise(360,220)
    rec={r['scenario_id']:r for r in answer['recommendations']}
    assert answer['recommendations'][0]['scenario_id']=='defense'
    assert rec['combined']['evidence_quality']['cluster_clubs']==2
    assert rec['defense']['score']>rec['combined']['score']
    assert rec['defense']['evidence_quality']['reliability']>rec['combined']['evidence_quality']['reliability']
    rows=frame();pool=rows[(rows.team_id==360)&(rows.points<3)]
    chosen=pool[pool.match_id==rec['defense']['supporting_match_id']].iloc[0]
    assert chosen.central_xga==pytest.approx(pool.central_xga.max())
    assert 'xGA' in rec['defense']['evidence_match_criterion']
    assert answer['ranking']['weights']['modeled_gain']<.11


def test_historical_combined_scenario_does_not_reintroduce_season_clusters():
    from app.advisor import advise
    from app.data import frame
    answer=advise(360,220,as_of='2016-04-23',scenario={
        'id':'combined','title':'Сочетание допущений','shot_quality_change':.05,'xga_reduction':.05})
    dates=frame().drop_duplicates('match_id').set_index('match_id').match_date
    for rec in answer['recommendations']:
        assert rec['opponent_context'] is None
        assert dates.loc[rec['supporting_match_id']]<'2016-04-23'
        assert all(dates.loc[mid]<'2016-04-23' for e in rec['supporting_metrics'] for mid in e['match_ids'])
        for evidence in rec['supporting_metrics']:
            if evidence['metric']=='xga' and ':before:' in evidence['id'] and ':nonwinning:' not in evidence['id']:
                own=frame();own=own[(own.team_id==360)&(own.match_date<'2016-04-23')]
                assert evidence['value']==pytest.approx(own.xga.mean())


def test_all_club_opponent_interpretations_require_magnitude_and_support():
    from app.coaching import opponent_snapshot
    from app.data import query
    clubs=query('SELECT * FROM clubs')
    for c in clubs:
        profile=opponent_snapshot(360 if c['team_id']!=360 else 220,c['team_id'])
        for item in profile['strengths']+profile['vulnerabilities']:
            assert item['sample_size']>=12
            assert abs(item['delta'])>=item['descriptive_margin']
            assert not item['mean_interval'][0]<=item['benchmark']<=item['mean_interval'][1]
        if c['name']=='Eibar':
            xg=next(x for x in profile['comparisons'] if x['metric']=='xg')
            assert xg['value']==pytest.approx(1.3207525954368422)
            assert xg['status']=='parity'
            assert xg not in profile['strengths']


def test_balanced_real_madrid_malaga_xg_is_consistent_in_both_descriptions():
    from app.analytics import match_analysis
    from app.data import frame
    rows=frame()
    candidates=rows[(rows.team_id==220)&(rows.opponent_name=='Málaga')]
    row=candidates.loc[candidates.xgd.abs().idxmin()]
    assert abs(row.xgd)<.15
    match=match_analysis(int(row.match_id),220)
    coaching=match['visuals']['coaching']
    assert coaching['xg_comparison']['category']=='balanced'
    assert coaching['xg_leader'] is None
    assert 'примерно равноценные' in coaching['issue']
    assert 'примерно равноценные' in match['visuals']['interpretation']
    assert 'преимущество' not in coaching['issue'].lower()


@pytest.mark.parametrize('xg,xga,category',[(1.6,1.56,'balanced'),(1.6,1.2,'moderate'),(2.5,.5,'substantial'),(.5,2.5,'substantial')])
def test_descriptive_xg_thresholds_are_symmetric(xg,xga,category):
    from app.coaching import match_xg_comparison
    result=match_xg_comparison(xg,xga)
    assert result['category']==category
    assert match_xg_comparison(xga,xg)['category']==category
    assert 'не тест значимости' in result['note']


def test_small_sample_is_not_declared_opponent_strength():
    from app.coaching import opponent_snapshot
    from app.data import frame
    rows=frame();rows=rows[rows.match_date<'2015-10-01']
    result=opponent_snapshot(360,220,rows)
    assert not result['strengths'] and not result['vulnerabilities']


@pytest.mark.parametrize('team_id',[217,220])
def test_strong_clubs_use_real_nonwinning_context_without_invented_league_deficit(team_id):
    from app.coaching import team_snapshot
    from app.data import frame
    result=team_snapshot(team_id)
    assert 'общей слабости' in result['text']
    assert 'без победы' in result['title']
    rows=frame();rows=rows[rows.team_id==team_id]
    assert rows.loc[rows.match_id==result['match_id'],'points'].iloc[0]<3
    for e in result['evidence']:
        assert e['value']==pytest.approx(rows.loc[rows.points<3,e['metric']].mean())
        assert e['benchmark']==pytest.approx(rows.loc[rows.points==3,e['metric']].mean())


@pytest.mark.parametrize('upstream,expected,attempts',[(401,503,1),(429,429,1),(503,502,1),(500,502,1),('timeout',504,1)])
def test_sdk_errors_are_safe_and_retries_bounded(monkeypatch,upstream,expected,attempts):
    monkeypatch.setenv('OPENAI_API_KEY','test-only-key')
    monkeypatch.setattr(llm,'provider_context',lambda context:{})
    monkeypatch.setattr(llm.time,'sleep',lambda seconds:None)
    calls=[]
    def handler(request):
        calls.append(request)
        if upstream=='timeout':raise httpx2.ReadTimeout('provider-private-trace',request=request)
        return httpx2.Response(upstream,json={'error':{'message':'provider-private-trace','type':'test_error'}})
    real_client=httpx2.Client
    monkeypatch.setattr(llm,'_http_client',lambda:real_client(transport=httpx2.MockTransport(handler)))
    with pytest.raises(llm.HTTPException) as error:
        llm.request_provider({},'Что проверить?',[])
    assert error.value.status_code==expected and len(calls)==attempts
    assert 'provider-private-trace' not in error.value.detail and 'test-only-key' not in error.value.detail
