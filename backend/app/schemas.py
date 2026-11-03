"""Типизированный публичный API для шести модулей будущего интерфейса."""
from __future__ import annotations

from datetime import date
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, JsonValue, model_validator

Number = FiniteFloat
Fraction = Annotated[FiniteFloat,Field(ge=-.5,le=.5)]
TeamId = Annotated[int,Field(gt=0)]


class Input(BaseModel):
    model_config=ConfigDict(extra='forbid')


class Club(BaseModel):
    team_id: int
    name: str


class Probabilities(BaseModel):
    win: Annotated[FiniteFloat,Field(ge=0,le=1)]
    draw: Annotated[FiniteFloat,Field(ge=0,le=1)]
    loss: Annotated[FiniteFloat,Field(ge=0,le=1)]


class GoalProbabilities(Probabilities):
    expected_points: Annotated[FiniteFloat,Field(ge=0,le=3)]
    omitted_tail: Number


class Evidence(BaseModel):
    id: str
    team_id: int
    metric: str
    label: str
    value: Number | None
    benchmark: Number | None
    match_ids: list[int]
    kind: str
    note: str


class Hypothesis(BaseModel):
    id: str
    question: str
    h0: str
    h1: str
    method: str
    sample_size: dict[str,int]
    statistic: Number | None
    p_value: Number | None
    p_adjusted: Number | None
    significant: bool
    effect_size: dict[str,JsonValue] | None
    confidence_interval: dict[str,JsonValue] | None
    interpretation: str
    limitations: list[str]
    correction: str
    match_ids: list[int]


class OverviewResponse(BaseModel):
    visuals: dict[str,JsonValue]
    team: Club
    season: str
    summary: dict[str,JsonValue]
    home_away: list[dict[str,JsonValue]]
    recent_form: list[dict[str,JsonValue]]
    rolling: list[dict[str,JsonValue]]
    rolling_note: str
    league_table: list[dict[str,JsonValue]]
    table_note: str
    problem: dict[str,JsonValue]


class ResearchResponse(BaseModel):
    team: Club
    problem: dict[str,JsonValue]
    stages: list[dict[str,JsonValue]]
    comparisons: list[dict[str,JsonValue]]
    correlations: list[dict[str,JsonValue]]
    hypotheses: list[Hypothesis]
    findings: list[dict[str,JsonValue]]
    shot_zones: list[dict[str,JsonValue]]
    evidence: list[Evidence]
    context: dict[str,JsonValue]
    chance_diagnosis: dict[str,JsonValue]
    opponent_endpoint: str
    limitations: list[str]


class MatchAnalysisResponse(BaseModel):
    visuals: dict[str,JsonValue]
    match: dict[str,JsonValue]
    team: Club
    teams: list[dict[str,JsonValue]]
    shots: list[dict[str,JsonValue]]
    pass_patterns: list[dict[str,JsonValue]]
    lineups: list[dict[str,JsonValue]]
    quality: dict[str,JsonValue]
    evidence_id: str
    coordinate_note: str
    limitations: list[str]


class OpponentsResponse(BaseModel):
    visuals: dict[str,JsonValue]
    team: Club
    team_cluster: int
    team_profile: dict[str,Number]
    style_model: dict[str,JsonValue]
    against_styles: list[dict[str,JsonValue]]
    similar_to: Club
    similar_opponents: list[dict[str,JsonValue]]
    opponent_context: dict[str,JsonValue] | None


class PredictionRequest(Input):
    team_id: TeamId
    opponent_id: TeamId | None = None
    is_home: bool = True
    match_id: TeamId | None = None
    as_of: date | None = None

    @model_validator(mode='after')
    def check_context(self):
        if self.opponent_id==self.team_id:
            raise ValueError('Выберите другой клуб-соперник.')
        if self.match_id is None and self.opponent_id is None:
            raise ValueError('Укажите матч тестовой выборки либо соперника для гипотетического анализа.')
        if self.match_id is not None and self.as_of is not None:
            raise ValueError('Дата исторического матча определяется источником; не указывайте as_of.')
        return self


class PredictionResponse(BaseModel):
    team: Club
    context: dict[str,JsonValue]
    probabilities: Probabilities
    model_name: str
    evaluation: dict[str,JsonValue]
    important_features: list[dict[str,JsonValue]]
    features: dict[str,Number]
    measured: str
    limitations: list[str]


class ScenarioInput(Input):
    id: str = Field(min_length=1,max_length=40,pattern=r'^[a-zA-Z0-9_-]+$')
    title: str = Field(min_length=1,max_length=160)
    shot_volume_change: Fraction = 0
    shot_quality_change: Fraction = 0
    attack_xg_change: Fraction = 0
    xga_reduction: Fraction = 0

    @model_validator(mode='after')
    def no_double_counting(self):
        if self.attack_xg_change and (self.shot_volume_change or self.shot_quality_change):
            raise ValueError('Нельзя одновременно менять xG напрямую и через объём или качество ударов.')
        return self


class ContextRequest(Input):
    team_id: TeamId
    opponent_id: TeamId | None = None
    is_home: bool = True
    priority: Literal['balanced','attack','defense'] = 'balanced'
    max_interventions: int = Field(default=2,ge=1,le=2)
    priority_strength: Annotated[FiniteFloat,Field(ge=0,le=1)] = .15

    @model_validator(mode='after')
    def distinct_teams(self):
        if self.team_id==self.opponent_id:
            raise ValueError('Клуб и соперник должны различаться.')
        return self


class SimulationRequest(ContextRequest):
    as_of: date | None = None
    scenarios: list[ScenarioInput] | None = Field(default=None,min_length=1,max_length=8)

    @model_validator(mode='after')
    def unique_scenarios(self):
        if self.scenarios and len({s.id for s in self.scenarios})!=len(self.scenarios):
            raise ValueError('ID сценариев должны быть уникальны.')
        return self


class AdvisorRequest(ContextRequest):
    scenario: ScenarioInput | None = None
    as_of: date | None = None


class SimulationBaseline(BaseModel):
    team: Club
    opponent: Club | None
    is_home: bool
    as_of: str | None
    mode: str
    attack_xg: Number
    defense_xg: Number
    probabilities: GoalProbabilities
    sample_size: int
    opponent_sample_size: int
    prior_matches: int
    confidence_intervals: dict[str,list[Number]]
    evidence: list[Evidence]
    match_ids: list[int]
    method: str
    uncertainty: str


class ScenarioResult(BaseModel):
    id: str
    title: str
    assumptions: dict[str,Number]
    attack_xg: Number
    defense_xg: Number
    probabilities: GoalProbabilities
    delta_expected_points: Number
    sensitivity: list[dict[str,JsonValue]]
    interventions: int
    eligible: bool
    priority_score: Number
    evidence_ids: list[str]
    uncertainty: str


class SimulationResponse(BaseModel):
    team_id: int
    opponent_id: int | None
    baseline: SimulationBaseline
    scenarios: list[ScenarioResult]
    planning: dict[str,JsonValue]
    limitations: list[str]


class Recommendation(BaseModel):
    id: str
    title: str
    diagnosed_problem: str
    status: str
    evidence_ids: list[str]
    supporting_metrics: list[Evidence]
    opponent_context: dict[str,JsonValue] | None
    experiment: str
    evaluation_plan: str
    scenario_id: str
    scenario_assumptions: dict[str,Number]
    modeled_delta_expected_points: Number
    modeled_sensitivity: list[dict[str,JsonValue]]
    interventions: int
    eligible: bool
    score: Number
    score_components: dict[str,Number]
    score_sensitivity: list[dict[str,Number]]
    risks: list[str]
    uncertainty: list[str]
    selected_for_testing: bool


class AdvisorResponse(BaseModel):
    selected_scenario_id: str | None
    team: Club
    opponent: Club | None
    recommendations: list[Recommendation]
    evidence: list[Evidence]
    simulation: SimulationResponse
    ranking: dict[str,JsonValue]
    model_context: dict[str,JsonValue]
    measured: str
    modeled: str
    limitations: list[str]


class HealthResponse(BaseModel):
    status: str
    ready: bool


class MetaResponse(BaseModel):
    name: str
    modules: list[str]
    coverage: dict[str,JsonValue]
    definitions: dict[str,str]
    metric_labels: dict[str,str]
    limitations: list[str]
    attribution: str
