from __future__ import annotations

from pathlib import Path
from dotenv import load_dotenv

# Локальный файл игнорируется Git; явно заданное окружение имеет приоритет.
load_dotenv(Path(__file__).resolve().parents[2] / '.env', override=False)

from fastapi import FastAPI,Query,Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import analytics,opponents,prediction,simulator,advisor,coaching,llm
from app.data import query,get_meta,DEFINITIONS,LIMITATIONS,METRIC_LABELS,DB_PATH,MODEL_DIR
from app.schemas import (Club,HealthResponse,MetaResponse,OverviewResponse,ResearchResponse,
    MatchAnalysisResponse,OpponentsResponse,PredictionRequest,PredictionResponse,
    SimulationRequest,SimulationResponse,AdvisorRequest,AdvisorResponse,AIRequest,BriefRequest,BriefResponse)

app=FastAPI(title='Football AI — Тактический интеллект',version='1.0.0',
    description='Лабораторная работа №2. Сценарий №4: почему команда теряет очки. Историческая аналитика, проверка гипотез и выбор тактических экспериментов.',
    docs_url='/api/docs',redoc_url=None)
app.add_middleware(CORSMiddleware,allow_origins=['http://localhost:5173','http://127.0.0.1:5173'],
                   allow_methods=['GET','POST'],allow_headers=['Content-Type','X-Football-AI'])


@app.exception_handler(ValueError)
async def invalid_value(request: Request,exc: ValueError):
    return JSONResponse(status_code=400,content={'detail':str(exc)})


@app.exception_handler(FileNotFoundError)
async def missing_data(request: Request,exc: FileNotFoundError):
    return JSONResponse(status_code=503,content={'detail':'Данные или модели не подготовлены. Выполните python scripts/prepare_data.py из папки backend.'})


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request,exc: RequestValidationError):
    errors=[]
    for e in exc.errors():
        message=str(e.get('ctx',{}).get('error','Недопустимое значение или отсутствует обязательный параметр.'))
        errors.append({'field':'.'.join(map(str,e['loc'])),'message':message})
    return JSONResponse(status_code=422,content={'detail':'Проверьте параметры запроса.','errors':errors})


@app.get('/api/health',response_model=HealthResponse,summary='Готовность локального backend')
def health():
    ready=DB_PATH.exists() and all((MODEL_DIR/name).exists() for name in ('styles.joblib','outcome.joblib'))
    if ready:
        try:
            get_meta('coverage'); get_meta('prediction')
            ready=len(query("SELECT key FROM metadata WHERE key LIKE 'research:%'"))==20
        except (ValueError,FileNotFoundError):
            ready=False
    return {'status':'Готово' if ready else 'Требуется подготовка данных','ready':ready}


@app.get('/api/meta',response_model=MetaResponse,summary='Источник, покрытие, определения и ограничения')
def meta():
    return {'name':'Football AI — Тактический интеллект',
        'modules':['Обзор команды','Анализ матчей','Анализ соперников','ML-прогноз','Симулятор','AI-советник'],
        'coverage':get_meta('coverage'),'definitions':DEFINITIONS,'metric_labels':METRIC_LABELS,
        'limitations':LIMITATIONS,'attribution':'Источник данных и xG: StatsBomb Open Data (Hudl), https://github.com/hudl/open-data. При публикации интерфейса требуется атрибуция StatsBomb и логотип из официального Media Pack.'}


@app.get('/api/clubs',response_model=list[Club],summary='Все доступные клубы со StatsBomb ID')
def clubs():
    return query('SELECT * FROM clubs ORDER BY name')


@app.get('/api/clubs/{team_id}/overview',response_model=OverviewResponse,summary='Обзор выбранной команды')
def overview(team_id: int):
    return analytics.overview(team_id)


@app.get('/api/clubs/{team_id}/research',response_model=ResearchResponse,summary='Исследования, четыре гипотезы и свидетельства')
def research(team_id: int):
    return analytics.research(team_id)


@app.get('/api/clubs/{team_id}/matches',response_model=list[dict],summary='История матчей выбранного клуба')
def matches(team_id: int):
    return analytics.team_matches(team_id)


@app.get('/api/matches/{match_id}/analysis',response_model=MatchAnalysisResponse,summary='Матч, карты ударов и направления передач')
def analysis(match_id: int,team_id: int=Query(...,gt=0)):
    return analytics.match_analysis(match_id,team_id)


@app.get('/api/clubs/{team_id}/opponents',response_model=OpponentsResponse,summary='Стили, похожие соперники и результаты против групп')
def opponent_analysis(team_id: int,opponent_id: int|None=Query(None,gt=0)):
    return opponents.opponent_analysis(team_id,opponent_id)


@app.get('/api/prediction/metrics',response_model=dict,summary='Хронология разбиения и реальные метрики моделей')
def prediction_metrics():
    return get_meta('prediction')


@app.post('/api/prediction',response_model=PredictionResponse,summary='Тестовая историческая оценка или гипотетическое сравнение')
def predict(body: PredictionRequest):
    return prediction.predict(**body.model_dump())


@app.post('/api/simulation',response_model=SimulationResponse,summary='База и альтернативные тактические сценарии')
def simulate(body: SimulationRequest):
    return simulator.simulate(**body.model_dump())


@app.post('/api/advisor',response_model=AdvisorResponse,summary='Приоритетные тактические эксперименты со свидетельствами')
def advise(body: AdvisorRequest):
    return advisor.advise(**body.model_dump())


@app.get('/api/advisor/ai/status',response_model=dict,summary='Готовность опционального внешнего AI')
def ai_status(request: Request):
    llm.check_local(request)
    return llm.status()


@app.post('/api/advisor/ai',response_model=llm.AIResponse,summary='Обоснованный анализ с внешним AI по кнопке')
def ai_analysis(body: AIRequest,request: Request):
    return llm.generate(body,request)


@app.post('/api/coaching/brief',response_model=BriefResponse,summary='Тренерская сводка из проверенных расчётов')
def brief(body: BriefRequest):
    return coaching.coaching_brief(body)
