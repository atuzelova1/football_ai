"""Офлайн-контракты OpenAI API. Это регрессии, не запись прежнего live-ответа."""
import json
import socket
import ssl

import httpx2
import pytest
from fastapi.testclient import TestClient

from app import llm
from app.main import app
from app.schemas import AIRequest


BODY={'team_id':360,'opponent_id':220,'is_home':True,'as_of':'2016-04-23',
      'match_id':3825886,'historical_match_id':3825886,
      'scenario':{'id':'defense','title':'Защита центра','xga_reduction':.1}}
EVIDENCE='team:360:before:2016-04-23:xga'


def answer():
    return {'main_conclusion':'Допущенные моменты требуют отдельного разбора. Это гипотеза для штаба.',
        'recommendation':'Проверить согласованную страховку центральной зоны.',
        'unverified':True,'why':[{'text':'Наблюдаемая оборонительная нагрузка выше ориентира лиги.',
                                'evidence_ids':[EVIDENCE]}],
        'alternatives':[], 'risks':['Усиление центра может открыть фланги.'],
        'evaluation_plan':['Сравнить центральный допущенный xG.'],
        'missing_evidence':['Нужен ручной видеоразбор.']}


def envelope(text=None):
    return {'id':'resp_offline','object':'response','status':'completed','model':'gpt-4.1-mini',
        'output':[{'id':'msg_offline','type':'message','role':'assistant','status':'completed',
                   'content':[{'type':'output_text','text':text if text is not None else json.dumps(answer(),ensure_ascii=False),
                               'annotations':[]}]}]}


def chat_envelope(text=None,finish_reason='stop'):
    return {'id':'chatcmpl_offline','object':'chat.completion','model':'gpt-4.1-mini',
        'choices':[{'index':0,'finish_reason':finish_reason,'message':{
            'role':'assistant','content':text if text is not None else json.dumps(answer(),ensure_ascii=False)}}]}


def parse(data):
    return llm.parse_provider_response(json.dumps(data,ensure_ascii=False).encode())


def diagnostic(exc,code,field=None):
    assert exc.status_code==502
    assert exc.headers['X-Football-AI-Error']==code
    if field:
        assert exc.headers['X-Football-AI-Field']==field
    assert 'Расчётные рекомендации доступны' in exc.detail


def test_schema_and_instructions_match_backend_constraints():
    schema=llm.response_schema({'evidence':[{'id':EVIDENCE}]})
    assert schema['properties']['unverified']['const'] is True
    assert schema['properties']['main_conclusion']['pattern']
    assert schema['properties']['recommendation']['pattern']
    for name in ('risks','evaluation_plan','missing_evidence'):
        assert schema['properties'][name]['items']['pattern']
        assert schema['properties'][name]['items']['maxLength']==(120 if name=='missing_evidence' else 160)
    assert schema['$defs']['Reason']['properties']['text']['pattern']
    assert schema['$defs']['Reason']['properties']['evidence_ids']['items']['enum']==[EVIDENCE]
    assert schema['additionalProperties'] is False
    assert schema['$defs']['Reason']['additionalProperties'] is False
    assert 'только в массивы evidence_ids' in llm.SYSTEM


@pytest.mark.parametrize('field,value,code',[
    ('unverified',False,'schema.unverified_required'),
    ('unverified',1,'schema.unverified_required'),
    ('recommendation','Улучшение гарантирует 99 процентов побед.','text.unsupported_numeric_claim'),
    ('recommendation','Improved defence may reduce dangerous shots.','text.russian_required'),
    ('recommendation','Проверить https://example.com/private для уточнения.','text.unsafe_text'),
    ('recommendation',15,'schema.string_type'),
    ('recommendation','Да','schema.string_too_short'),
    ('risks',[],'schema.too_short'),
])
def test_previously_generic_502_now_names_exact_failed_rule(field,value,code):
    payload=answer();payload[field]=value
    with pytest.raises(llm.HTTPException) as error:
        parse(envelope(json.dumps(payload,ensure_ascii=False)))
    diagnostic(error.value,code,field)
    assert str(value) not in error.value.detail


def test_nested_numeric_claim_is_rejected_with_path_and_without_correction():
    payload=answer();payload['evaluation_plan'][0]='Сравнить xGA после 5 матчей.'
    with pytest.raises(llm.HTTPException) as error:
        parse(envelope(json.dumps(payload,ensure_ascii=False)))
    diagnostic(error.value,'text.unsupported_numeric_claim','evaluation_plan[0]')
    assert payload['evaluation_plan'][0]=='Сравнить xGA после 5 матчей.'


@pytest.mark.parametrize('case,code,field',[
    ('outer_json','api_response.invalid_json','analysis'),
    ('outer_list','api_response.invalid_envelope','response'),
    ('output_missing','api_response.invalid_envelope','output'),
    ('output_null','api_response.invalid_envelope','output'),
    ('refusal','api_response.refusal','output[0].content[0]'),
    ('empty_text','api_response.missing_text','output'),
    ('incomplete','api_response.output_limit','status'),
    ('inner_json','output_json.invalid_json','analysis'),
    ('inner_list','schema.model_type','analysis'),
    ('duplicate','output_json.duplicate_keys','analysis'),
    ('missing_field','schema.missing','recommendation'),
])
def test_response_failure_stages_are_separate(case,code,field):
    data=envelope()
    if case=='output_missing':data.pop('output')
    elif case=='output_null':data['output']=None
    elif case=='refusal':data['output'][0]['content']=[{'type':'refusal','refusal':'private-provider-text'}]
    elif case=='empty_text':data['output'][0]['content']=[]
    elif case=='incomplete':data.update(status='incomplete',incomplete_details={'reason':'max_output_tokens'})
    elif case=='inner_json':data=envelope('not-json-private-provider-text')
    elif case=='inner_list':data=envelope('[]')
    elif case=='duplicate':data=envelope('{"unverified":true,"unverified":false}')
    elif case=='missing_field':
        payload=answer();payload.pop('recommendation');data=envelope(json.dumps(payload))
    raw=b'not-json-private-provider-text' if case=='outer_json' else json.dumps([] if case=='outer_list' else data).encode()
    with pytest.raises(llm.HTTPException) as error:
        llm.parse_provider_response(raw)
    diagnostic(error.value,code,field)
    assert 'private-provider-text' not in error.value.detail


def test_valid_gpt41_envelope_and_fragmented_text_are_accepted():
    assert parse(envelope()).model_dump()==answer()
    text=json.dumps(answer(),ensure_ascii=False);data=envelope(text[:50])
    data['output'][0]['content'].append({'type':'output_text','text':text[50:]})
    assert parse(data).model_dump()==answer()


def test_diagnostics_never_echo_extra_field_names_values_or_provider_text(caplog):
    secret='sk-test-only-not-a-real-credential'
    payload=answer();payload[secret]={'private':'private-provider-text'}
    with pytest.raises(llm.HTTPException) as error:
        parse(envelope(json.dumps(payload)))
    diagnostic(error.value,'schema.extra_forbidden','*')
    for text in (error.value.detail,str(error.value.headers),caplog.text):
        assert secret not in text and 'private-provider-text' not in text


@pytest.mark.parametrize('unknown',[False,True])
def test_gpt41_sdk_http_contract_preserves_grounding_and_python_numbers(monkeypatch,unknown):
    # Настоящий SDK, но весь HTTP заменён MockTransport; внешней сети нет.
    monkeypatch.setenv('OPENAI_API_KEY','test-only-key')
    monkeypatch.setenv('OPENAI_MODEL','gpt-4.1-mini')
    llm._cache.clear();llm._answers.clear();llm._calls.clear()
    calls=[];real_client=httpx2.Client
    def handler(request):
        payload=json.loads(request.content);calls.append(payload)
        assert str(request.url)=='https://api.openai.com/v1/chat/completions'
        assert payload['model']=='gpt-4.1-mini' and 'reasoning' not in payload
        assert payload['store'] is False and 'tools' not in payload
        schema=payload['response_format']['json_schema']['schema']
        assert payload['response_format']['json_schema']['strict'] is True
        known=schema['$defs']['Reason']['properties']['evidence_ids']['items']['enum']
        assert EVIDENCE in known and schema['properties']['unverified']['type']=='boolean'
        assert llm.AnalysisDraft.model_json_schema()['properties']['unverified']['const'] is True
        result=answer()
        if unknown:result['why'][0]['evidence_ids']=['team:999:season:xga']
        return httpx2.Response(200,json=chat_envelope(json.dumps(result,ensure_ascii=False)))
    monkeypatch.setattr(llm,'_http_client',lambda:real_client(transport=httpx2.MockTransport(handler)))
    with TestClient(app,base_url='http://127.0.0.1:8000',client=('127.0.0.1',50000)) as client:
        response=client.post('/api/advisor/ai',json=BODY,headers={'X-Football-AI':'1'})
    assert len(calls)==1
    if unknown:
        assert response.status_code==502
        assert response.headers['X-Football-AI-Error']=='grounding.unknown_evidence'
        assert response.headers['X-Football-AI-Field']=='why[0].evidence_ids[0]'
        assert not llm._cache and not llm._answers
    else:
        assert response.status_code==200,response.text
        result=response.json()
        assert result['analysis']==answer() and not result['cached']
        assert result['scenario']['delta_expected_points']==pytest.approx(.09951130347766224)
        assert result['baseline']['probabilities']['expected_points']==pytest.approx(1.3119546231474017)
        assert all(':before:2016-04-23:' in e['id'] for e in result['evidence'])
    llm._cache.clear();llm._answers.clear();llm._calls.clear()



def test_compact_real_context_keeps_only_relevant_verified_facts_and_three_scenarios():
    from app.coaching import build_context
    context=build_context(AIRequest(**BODY))
    compact=llm.provider_context(context)
    assert len(json.dumps(compact,ensure_ascii=False))<11000
    assert compact['team']==context['team'] and compact['opponent']==context['opponent']
    assert compact['as_of']=='2016-04-23' and compact['historical_match_id']==3825886
    assert 1<=len(compact['evidence'])<=10
    assert len(compact['simulation']['alternatives'])==3
    assert compact['simulation']['baseline']['probabilities']==context['simulation']['baseline']['probabilities']
    originals={e['id']:e for e in context['evidence']}
    for e in compact['evidence']:
        assert e['value']==originals[e['id']]['value']
        assert e['benchmark']==originals[e['id']]['benchmark']
        assert e['example_match_ids'][0] in originals[e['id']]['match_ids']
    known={e['id'] for e in compact['evidence']}
    assert all(set(r['evidence_ids'])<=known and r['evidence_ids'] for r in compact['recommendations'])
    assert 'hypotheses' not in compact  # Исследование сохранено в приложении, не дублируется в prompt.
    assert all(m['match_date']<'2016-04-23' for m in compact['observed_match_examples'])


@pytest.mark.parametrize('configured,expected',[('1500',1500),('3500',3500),('6000',6000),('999',None),('6001',None),('secret-value',None)])
def test_output_budget_is_bounded_configurable_and_does_not_echo_bad_values(monkeypatch,configured,expected):
    monkeypatch.setenv('OPENAI_MAX_OUTPUT_TOKENS',configured)
    if expected is not None:
        assert llm.output_token_limit()==expected
    else:
        with pytest.raises(llm.HTTPException) as error:llm.output_token_limit()
        assert error.value.status_code==503 and configured not in error.value.detail


def test_response_schema_has_a_bounded_short_brief_instead_of_report():
    schema=llm.AnalysisDraft.model_json_schema();p=schema['properties']
    assert p['main_conclusion']['maxLength']==240
    assert p['recommendation']['maxLength']==260
    assert p['why']['maxItems']==2 and p['alternatives']['maxItems']==2
    assert schema['$defs']['Reason']['properties']['text']['maxLength']==200
    # Максимум текста без JSON-синтаксиса/ID; это символы, не измеренные токены.
    maximum=240+260+2*200+2*200+2*160+3*160+120
    assert maximum==2220


@pytest.mark.parametrize('output_tokens,reasoning_tokens,text',[(0,None,'{"main_conclusion":"частичный текст'),(3500,3400,'{'),(None,None,'')])
def test_incomplete_metadata_distinguishes_usage_reasoning_and_visible_text(output_tokens,reasoning_tokens,text,caplog):
    data=envelope(text);data.update(status='incomplete',incomplete_details={'reason':'max_output_tokens'},max_output_tokens=3500)
    data['usage']={'input_tokens':8304}
    if output_tokens is not None:data['usage']['output_tokens']=output_tokens
    if reasoning_tokens is not None:data['usage']['output_tokens_details']={'reasoning_tokens':reasoning_tokens}
    with pytest.raises(llm.HTTPException) as error:
        llm.parse_provider_response(json.dumps(data).encode(),requested_limit=3500)
    diagnostic(error.value,'api_response.output_limit','status')
    info=json.loads(error.value.headers['X-Football-AI-Diagnostics'])
    assert info['input_tokens']==8304
    assert info['output_tokens']==output_tokens and info['reasoning_tokens']==reasoning_tokens
    assert info['output_text_chars']==len(text)
    assert info['zero_usage_with_text']==(output_tokens==0 and bool(text))
    assert info['requested_max_output_tokens']==3500 and info['response_max_output_tokens']==3500
    assert info['output_item_types']==['message'] and info['content_types']==['output_text']
    assert 'частичный текст' not in caplog.text and 'частичный текст' not in error.value.detail
    assert 'Автоматического продолжения нет' in error.value.detail


def test_diagnostics_preserve_absent_counts_and_never_echo_untrusted_metadata():
    info=llm.response_diagnostics({'status':'sk-private','incomplete_details':{'reason':'private-secret'},
        'output':[{'type':'reasoning','summary':[{'text':'private summary'}]},
                  {'type':'private type','content':[{'type':'private content','text':'private text'}]}]})
    assert info['output_tokens'] is None and info['reasoning_tokens'] is None
    assert info['status']=='unknown' and info['incomplete_reason']=='unknown'
    assert info['output_item_types']==['other','reasoning']
    assert info['reasoning_summary_chars']==len('private summary')
    assert info['output_text_chars']==0
    encoded=json.dumps(info)
    assert 'private' not in encoded and 'sk-' not in encoded
    assert llm.response_diagnostics({'status':{},'output':[]})['status']=='unknown'


def test_sdk_incomplete_response_is_not_retried_or_repaired(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','test-only-key')
    monkeypatch.setenv('OPENAI_MODEL','gpt-5-mini')
    monkeypatch.setenv('OPENAI_MAX_OUTPUT_TOKENS','3500')
    monkeypatch.setattr(llm,'provider_context',lambda c:{})
    real_client=httpx2.Client;calls=[]
    def handler(request):
        p=json.loads(request.content);calls.append(p)
        assert p['max_output_tokens']==3500 and p['reasoning']=={'effort':'low'}
        data=envelope('{"main_conclusion":')
        data.update(status='incomplete',incomplete_details={'reason':'max_output_tokens'})
        data['usage']={'output_tokens':0,'output_tokens_details':{'reasoning_tokens':0}}
        return httpx2.Response(200,json=data)
    monkeypatch.setattr(llm,'_http_client',lambda:real_client(transport=httpx2.MockTransport(handler)))
    with pytest.raises(llm.HTTPException) as error:llm.request_provider({},'Что проверить?',[])
    diagnostic(error.value,'api_response.output_limit','status')
    assert len(calls)==1


@pytest.mark.parametrize('cause,code,status_code',[
    (PermissionError(13,'private-sandbox-denied'),'transport.permission',502),
    (socket.gaierror(-2,'private-dns-value'),'transport.dns',502),
    (ssl.SSLCertVerificationError('private-certificate'),'transport.tls',502),
    (httpx2.ConnectTimeout('private-timeout'),'transport.connect_timeout',502),
    (httpx2.ReadTimeout('private-read'),'transport.timeout',504),
    (httpx2.RemoteProtocolError('private-peer'),'transport.protocol',502),
    (TypeError('private-client-error'),'transport.client_error',502),
])
def test_connection_diagnostics_name_cause_without_exposing_private_values(cause,code,status_code,caplog):
    error=llm.APIConnectionError(request=httpx2.Request('POST','https://api.openai.com/v1/responses'))
    error.__cause__=cause
    result=llm.connection_error(error)
    assert result.status_code==status_code
    assert result.headers['X-Football-AI-Error']==code
    assert 'private' not in result.detail+caplog.text
    assert llm.status()['last_error_code']==code


def test_status_identifies_running_code_and_stale_process(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','test-only-key')
    monkeypatch.setenv('OPENAI_MODEL','gpt-4.1-mini')
    status=llm.status()
    assert status['available'] and status['source_is_current']
    assert status['process_id']>0 and status['integration_version']==llm.VERSION
    assert 'test-only-key' not in json.dumps(status)
    monkeypatch.setattr(llm,'_SOURCE_DIGEST','older-source')
    assert llm.status()['source_is_current'] is False


def manual_attempt_envelope():
    # Подтверждённые метаданные из console backend PID 10908. Это реконструкция:
    # исходный JSON не сохранялся, поэтому text='' отдельно проверяется против
    # отсутствующего text и null — все три случая давали старый счётчик 0.
    data=envelope('')
    data.update(status='incomplete',incomplete_details={'reason':'max_output_tokens'},max_output_tokens=3500)
    data['usage']={'input_tokens':4594,'output_tokens':0,
                   'output_tokens_details':{'reasoning_tokens':0},'total_tokens':4594}
    return data


@pytest.mark.parametrize('text_case,expected_chars,expected_state',[
    ('empty',0,'present'),('missing',None,'missing_text'),('null',None,'invalid_text')])
def test_logged_manual_attempt_takes_limit_branch_before_json_and_grounding(monkeypatch,text_case,expected_chars,expected_state):
    data=manual_attempt_envelope();part=data['output'][0]['content'][0]
    if text_case=='missing':part.pop('text')
    elif text_case=='null':part['text']=None
    old_count=sum(len(p['text']) for item in data['output'] for p in item['content']
                  if p.get('type')=='output_text' and isinstance(p.get('text'),str))
    assert old_count==0  # Неоднозначность старой записи лога воспроизведена.
    monkeypatch.setattr(llm,'validate_analysis',lambda _:pytest.fail('Проверка анализа не должна запускаться для incomplete'))
    with pytest.raises(llm.HTTPException) as error:
        llm.parse_provider_response(json.dumps(data).encode(),requested_limit=3500)
    diagnostic(error.value,'api_response.output_limit','status')
    info=json.loads(error.value.headers['X-Football-AI-Diagnostics'])
    assert info['status']=='incomplete' and info['incomplete_reason']=='max_output_tokens'
    assert info['requested_max_output_tokens']==info['response_max_output_tokens']==3500
    assert (info['input_tokens'],info['output_tokens'],info['reasoning_tokens'],info['total_tokens'])==(4594,0,0,4594)
    assert info['output_item_types']==['message'] and info['content_types']==['output_text']
    assert info['output_text_parts']==1 and info['output_text_state']==expected_state
    assert info['output_text_chars']==expected_chars
    assert 'Провайдер сообщил' in error.value.detail
    assert ('длина текста: неизвестна' in error.value.detail)==(expected_chars is None)


@pytest.mark.parametrize('missing_field',['usage','output_tokens','reasoning_tokens','output','text'])
def test_absent_manual_attempt_fields_are_not_reported_as_zero(missing_field):
    data=manual_attempt_envelope()
    if missing_field=='usage':data.pop('usage')
    elif missing_field=='output_tokens':data['usage'].pop('output_tokens')
    elif missing_field=='reasoning_tokens':data['usage']['output_tokens_details'].pop('reasoning_tokens')
    elif missing_field=='output':data.pop('output')
    else:data['output'][0]['content'][0].pop('text')
    info=llm.response_diagnostics(data,3500)
    if missing_field=='usage':assert all(info[k] is None for k in ('input_tokens','output_tokens','reasoning_tokens','total_tokens'))
    elif missing_field in ('output_tokens','reasoning_tokens'):assert info[missing_field] is None
    else:assert info['output_text_chars'] is None


def test_incomplete_without_provider_limit_reason_is_not_labelled_output_limit():
    data=manual_attempt_envelope();data.pop('incomplete_details')
    with pytest.raises(llm.HTTPException) as error:parse(data)
    diagnostic(error.value,'api_response.incomplete','status')


def test_manual_attempt_sdk_limit_and_strict_schema_are_verified_offline(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','test-only-key')
    monkeypatch.setenv('OPENAI_MODEL','gpt-5-mini')
    monkeypatch.setenv('OPENAI_MAX_OUTPUT_TOKENS','3500')
    monkeypatch.setattr(llm,'provider_context',lambda c:{'evidence':[{'id':EVIDENCE}]})
    real_client=httpx2.Client;calls=[]
    def handler(request):
        payload=json.loads(request.content);calls.append(payload)
        assert payload['max_output_tokens']==3500 and payload['model']=='gpt-5-mini'
        assert payload['reasoning']=={'effort':'low'} and payload['store'] is False
        fmt=payload['text']['format'];assert fmt['type']=='json_schema' and fmt['strict'] is True
        schema=fmt['schema'];assert schema['properties']['main_conclusion']['maxLength']==240
        assert schema['properties']['recommendation']['maxLength']==260
        assert schema['$defs']['Reason']['properties']['evidence_ids']['items']['enum']==[EVIDENCE]
        return httpx2.Response(200,json=manual_attempt_envelope())
    monkeypatch.setattr(llm,'_http_client',lambda:real_client(transport=httpx2.MockTransport(handler)))
    with pytest.raises(llm.HTTPException) as error:llm.request_provider({},'Почему ответ не завершён?',[])
    diagnostic(error.value,'api_response.output_limit','status')
    assert len(calls)==1


@pytest.mark.parametrize('model,path',[
    ('gpt-4.1-mini','/v1/chat/completions'),('gpt-5-mini','/v1/responses')])
@pytest.mark.parametrize('http_status,provider_code,expected,backend_status',[
    (404,'model_not_found','provider.model',502),
    (404,'previous_response_not_found','provider.resource_not_found',502),
    (404,'invalid_url','provider.not_found',502),
    (404,None,'provider.not_found',502),
    (403,'model_not_found','provider.model',502),
    (401,'invalid_api_key','provider.access',503),
    (429,'rate_limit_exceeded','provider.limit',429),
    (500,'server_error','provider.unavailable',502),
    (400,'invalid_value','provider.request',502)])
def test_provider_http_errors_preserve_safe_fields_without_guessing_model_failure(
        monkeypatch,caplog,model,path,http_status,provider_code,expected,backend_status):
    monkeypatch.setenv('OPENAI_API_KEY','test-only-key')
    monkeypatch.setenv('OPENAI_MODEL',model)
    monkeypatch.setattr(llm,'provider_context',lambda c:{})
    real_client=httpx2.Client;calls=[]
    def handler(request):
        calls.append(request)
        assert request.method=='POST' and request.url.path==path
        return httpx2.Response(http_status,headers={'x-request-id':'req_offline404'},json={
            'error':{'code':provider_code,'type':'invalid_request_error','param':'model',
                     'message':'private provider text sk-do-not-echo'}})
    monkeypatch.setattr(llm,'_http_client',lambda:real_client(transport=httpx2.MockTransport(handler)))
    with pytest.raises(llm.HTTPException) as error:llm.request_provider({},'Что проверить?',[])
    assert len(calls)==1
    assert error.value.status_code==backend_status
    assert error.value.headers['X-Football-AI-Error']==expected
    metadata=json.loads(error.value.headers['X-Football-AI-Diagnostics'])
    assert metadata=={'http_status':http_status,'code':provider_code,'type':'invalid_request_error',
                      'param':'model','request_id':'req_offline404'}
    assert llm.status()['last_provider_error']==metadata
    for text in (error.value.detail,str(error.value.headers),caplog.text,json.dumps(llm.status())):
        assert 'private provider text' not in text and 'sk-do-not-echo' not in text and 'test-only-key' not in text


@pytest.mark.parametrize('body',[
    {'error':{'code':'sk-private-secret','type':'proj_private','param':'input.sk_private'}},
    {'code':['model_not_found'],'type':{'private':'value'},'param':'model\nsecret'},
    'private non-JSON provider body'])
def test_provider_error_diagnostics_redact_untrusted_values(body,caplog):
    response=httpx2.Response(404,request=httpx2.Request('POST','https://api.openai.com/v1/responses'),
                            headers={'x-request-id':'sk-private-secret'})
    exc=llm.APIStatusError('private exception message',response=response,body=body)
    result=llm.provider_status_error(exc)
    assert result.headers['X-Football-AI-Error']=='provider.not_found'
    metadata=json.loads(result.headers['X-Football-AI-Diagnostics'])
    assert metadata=={'http_status':404,'code':None,'type':None,'param':None,'request_id':None}
    assert 'private' not in caplog.text+result.detail+str(result.headers)


@pytest.mark.parametrize('value,expected',[
    ('gpt-4.1-mini','gpt-4.1-mini'),('  gpt-4.1-mini \n','gpt-4.1-mini'),
    ('gpt-4.1-mini Atmet.',None),('gpt-4.1-mini\nprivate',None),
    ('',None),('sk-private-secret',None)])
def test_invalid_model_is_rejected_locally_without_echo_or_provider_request(monkeypatch,value,expected,caplog):
    monkeypatch.setenv('OPENAI_MODEL',value)
    if expected:
        assert llm.configured_model()==expected
        assert llm.status()['model']==expected
    else:
        monkeypatch.setattr(llm,'_http_client',lambda:pytest.fail('Invalid configuration must not reach HTTP'))
        monkeypatch.setattr(llm,'provider_context',lambda _:pytest.fail('Invalid configuration is rejected first'))
        with pytest.raises(llm.HTTPException) as error:llm.request_provider({},'Что проверить?',[])
        assert error.value.status_code==503
        assert error.value.headers['X-Football-AI-Error']=='configuration.model'
        assert 'Atmet.' not in caplog.text+error.value.detail
        assert 'sk-private-secret' not in caplog.text+error.value.detail


@pytest.mark.parametrize('scoped',[False,True])
def test_sdk_organization_and_project_environment_are_used_for_same_client(monkeypatch,scoped):
    monkeypatch.setenv('OPENAI_API_KEY','test-only-key')
    monkeypatch.setenv('OPENAI_MODEL','gpt-4.1-mini')
    for key,value in [('OPENAI_ORG_ID','org_offline'),('OPENAI_PROJECT_ID','proj_offline')]:
        if scoped:monkeypatch.setenv(key,value)
        else:monkeypatch.delenv(key,raising=False)
    monkeypatch.setattr(llm,'provider_context',lambda c:{})
    real_client=httpx2.Client;calls=[]
    def handler(request):
        calls.append(request)
        assert request.headers['authorization']=='Bearer test-only-key'
        assert request.headers.get('OpenAI-Organization')==('org_offline' if scoped else None)
        assert request.headers.get('OpenAI-Project')==('proj_offline' if scoped else None)
        return httpx2.Response(200,json=chat_envelope())
    monkeypatch.setattr(llm,'_http_client',lambda:real_client(transport=httpx2.MockTransport(handler)))
    assert llm.request_provider({},'Что проверить?',[]).model_dump()==answer()
    assert len(calls)==1


def test_dotenv_override_false_preserves_inherited_model_and_scope(monkeypatch):
    from io import StringIO
    from dotenv import load_dotenv
    monkeypatch.setenv('OPENAI_MODEL','gpt-5-mini')
    monkeypatch.setenv('OPENAI_PROJECT_ID','proj_inherited_offline')
    monkeypatch.delenv('OPENAI_ORG_ID',raising=False)
    load_dotenv(stream=StringIO('OPENAI_MODEL=gpt-4.1-mini\nOPENAI_PROJECT_ID=proj_file_offline\nOPENAI_ORG_ID=org_file_offline'),override=False)
    assert llm.configured_model()=='gpt-5-mini'
    import os
    assert os.environ['OPENAI_PROJECT_ID']=='proj_inherited_offline'
    assert os.environ['OPENAI_ORG_ID']=='org_file_offline'


def test_http_client_enables_http2_without_disabling_tls_or_enabling_redirects(monkeypatch):
    options={}
    def client(**kwargs):options.update(kwargs);return 'offline-client'
    monkeypatch.setattr(llm.httpx2,'Client',client)
    assert llm._http_client()=='offline-client'
    assert options['http2'] is True and options['follow_redirects'] is False
    assert options['trust_env'] is False and options.get('verify',True) is True
    assert options['timeout'].connect==5 and options['timeout'].read==40


@pytest.mark.parametrize('received',[False,True])
def test_protocol_disconnect_records_stage_and_never_retries_or_exposes_text(monkeypatch,caplog,received):
    monkeypatch.setenv('OPENAI_API_KEY','test-only-key')
    monkeypatch.setenv('OPENAI_MODEL','gpt-4.1-mini')
    monkeypatch.setattr(llm,'provider_context',lambda _: {})
    real_client=httpx2.Client;calls=[]
    class BrokenStream(httpx2.SyncByteStream):
        def __iter__(self):
            raise httpx2.RemoteProtocolError('peer closed connection without sending complete message body (incomplete chunked read); sk-private-token')
            yield b''
    def handler(request):
        calls.append(request)
        if received:return httpx2.Response(200,stream=BrokenStream())
        raise httpx2.RemoteProtocolError('Server disconnected without sending a response. sk-private-token')
    monkeypatch.setattr(llm,'_http_client',lambda:real_client(transport=httpx2.MockTransport(handler)))
    with pytest.raises(llm.HTTPException) as error:llm.request_provider({},'Что проверить?',[])
    assert error.value.headers['X-Football-AI-Error']=='transport.protocol'
    assert len(calls)==1
    info=llm.status()['last_transport_error']
    assert info['response_headers_received'] is received
    assert info['protocol_reason']==('incomplete_body' if received else 'disconnected_before_headers')
    assert info['http_version']==('HTTP/1.1' if received else None)
    assert 'sk-private-token' not in caplog.text+error.value.detail+json.dumps(info)
