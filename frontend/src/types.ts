export interface Club {
  team_id: number;
  name: string;
}
export type Priority = "balanced" | "attack" | "defense";
export interface Probabilities {
  win: number;
  draw: number;
  loss: number;
  expected_points?: number;
}
export interface Evidence {
  id: string;
  team_id: number;
  metric: string;
  label: string;
  value: number | null;
  benchmark: number | null;
  match_ids: number[];
  kind: string;
  note: string;
}
export interface Summary {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  points_dropped: number;
  goals_for: number;
  goals_against: number;
  xg: number;
  xga: number;
  xgd: number;
  shots: number;
  shots_on_target: number;
  shots_against: number;
  shot_quality: number | null;
  conversion: number | null;
  pass_accuracy: number | null;
  passes: number;
  progressive_passes: number;
  ball_recoveries: number;
  defensive_events: number;
  dangerous: number;
  dangerous_against: number;
  per_match: Record<string, number>;
}
export interface TeamMatch {
  match_id: number;
  team_id: number;
  opponent_id: number;
  is_home: number;
  result: "W" | "D" | "L";
  result_label: string;
  match_date: string;
  match_week: number;
  team_name: string;
  opponent_name: string;
  goals_for: number;
  goals_against: number;
  points: number;
  xg: number;
  xga: number;
  xgd: number;
  shots: number;
  shots_against: number;
  shots_on_target: number;
  conversion: number | null;
  shot_quality: number | null;
  pass_accuracy: number;
  passes: number;
  completed_passes: number;
  progressive_passes: number;
  defensive_events: number;
  ball_recoveries: number;
  dangerous_against: number;
  dangerous: number;
  central_xga: number;
  central_against: number;
  attack_left: number;
  attack_center: number;
  attack_right: number;
}
export interface SeasonPoint {
  match_id: number;
  round: number;
  date: string;
  opponent: string;
  goals_for: number;
  goals_against: number;
  xg: number;
  xga: number;
  points: number;
  result: string;
}
export interface Overview {
  coaching: CoachSnapshot;
  team: Club;
  season: string;
  summary: Summary;
  home_away: { label: string; is_home: boolean; summary: Summary }[];
  recent_form: TeamMatch[];
  rolling: {
    match_id: number;
    match_date: string;
    window_matches: number;
    xg: number;
    xga: number;
    xgd: number;
    points: number;
  }[];
  rolling_note: string;
  league_table: (Club & {
    position: number;
    points: number;
    goals_for: number;
    goals_against: number;
  })[];
  table_note: string;
  problem: {
    question: string;
    user: string;
    points_dropped: number;
    decision: string;
  };
  visuals: {
    season_series: SeasonPoint[];
    league_comparison: {
      metric: string;
      label: string;
      team: number;
      league: number;
      index: number;
    }[];
    comparison_note: string;
  };
}
export interface Hypothesis {
  id: string;
  question: string;
  h0: string;
  h1: string;
  method: string;
  sample_size: Record<string, number>;
  statistic: number | null;
  p_value: number | null;
  p_adjusted: number | null;
  significant: boolean;
  effect_size: { name: string; value: number | null } | null;
  confidence_interval: {
    level: number;
    method: string;
    lower: number;
    upper: number;
  } | null;
  interpretation: string;
  limitations: string[];
  correction: string;
  match_ids: number[];
}
export interface Research {
  correlations: {
    metric: string;
    label: string;
    spearman_with_points: number | null;
    note: string;
  }[];
  team: Club;
  problem: {
    question: string;
    user: string;
    points_dropped: number;
    decision: string;
  };
  hypotheses: Hypothesis[];
  evidence: Evidence[];
  limitations: string[];
  findings: {
    id: string;
    title: string;
    status: string;
    supported_pattern: boolean;
    text: string;
    evidence_ids: string[];
    limitation?: string;
    mean_gap_interval_95?: number[];
  }[];
  comparisons: {
    metric: string;
    label: string;
    team: number;
    league_others: number;
    by_result: { result: string; n: number; mean: number | null }[];
  }[];
  shot_zones: {
    zone: string;
    zone_label: string;
    perspective: string;
    perspective_label: string;
    shots: number;
    xg: number;
    goals: number;
    dangerous: number;
  }[];
}
export interface Shot {
  event_id: string;
  team_id: number;
  player_id: number;
  player_name: string;
  minute: number;
  x: number | null;
  y: number | null;
  xg: number | null;
  outcome_label: string;
  goal: number;
  is_selected_team: boolean;
  zone: string;
}
export interface MatchAnalysis {
  team: Club;
  match: {
    match_id: number;
    match_date: string;
    home_id: number;
    away_id: number;
    home_score: number;
    away_score: number;
    match_week: number;
  };
  teams: (TeamMatch & { name: string })[];
  shots: Shot[];
  coordinate_note: string;
  visuals: {
    coaching: MatchReview;
    xg_timeline: { minute: number; team_xg: number; opponent_xg: number }[];
    quality_distribution: { label: string; team: number; opponent: number }[];
    attack_zones: {
      zone: string;
      label: string;
      team_shots: number;
      opponent_shots: number;
      team_xg: number;
      opponent_xg: number;
    }[];
    passing_matrix: {
      start_zone: number;
      end_zone: number;
      attempts: number;
      completed: number;
    }[];
    interpretation: string;
  };
}
export interface StyleGroup {
  cluster_id: number;
  name: string;
  matches: number;
  points_per_match: number | null;
  xg: number | null;
  xga: number | null;
  results: Record<string, number>;
  match_ids: number[];
}
export interface Opponents {
  team: Club;
  team_cluster: number;
  team_profile: Record<string, number>;
  against_styles: StyleGroup[];
  similar_to: Club;
  similar_opponents: (Club & { distance: number; cluster_id: number })[];
  opponent_context: {
    opponent: Club;
    cluster_id: number;
    profile: Record<string, number>;
    head_to_head: TeamMatch[];
  } | null;
  style_model: {
    selected_k: number;
    silhouette: number;
    sample_size: number;
    features: { id: string; label: string }[];
    clusters: {
      cluster_id: number;
      name: string;
      team_ids: number[];
      center: Record<string, number>;
      traits: { label: string; direction: string; z_score: number }[];
    }[];
    reliability_warning: string;
    limitations: string[];
    candidates: {
      k: number;
      silhouette: number;
      cluster_sizes: number[];
      eligible: boolean;
    }[];
    alternative_block_evaluation: {
      profiles: number;
      unit: string;
      interpretation: string;
      limitation: string;
    };
    bootstrap_stability: {
      median_ari: number;
      interval_95: number[];
      method: string;
    };
  };
  visuals: {
    coaching: OpponentReview;
    team_profiles: {
      team_id: number;
      cluster_id: number;
      passes: number;
      shots: number;
      profile: Record<string, number>;
    }[];
    cluster_comparison: { metric: string; values: Record<string, number> }[];
    radar: {
      metric: string;
      team: number;
      opponent: number | null;
      league: number;
      team_raw: number;
      opponent_raw: number | null;
    }[];
    normalization: string;
  };
}
export interface ModelEvaluation {
  calibration: {
    class_label: string;
    bins: {
      lower: number;
      upper: number;
      n: number;
      predicted: number;
      observed: number;
    }[];
  }[];
  n: number;
  accuracy: number;
  macro_f1: number;
  log_loss: number;
  brier_multiclass: number;
  accuracy_interval_95: number[];
  per_class: {
    label: string;
    precision: number;
    recall: number;
    f1: number;
    support: number;
  }[];
  confusion_matrix: {
    labels: string[];
    rows: string;
    columns: string;
    values: number[][];
  };
}
export interface ModelMetrics {
  selected_model: string;
  selected_model_name: string;
  selection_rule: string;
  fit_end: string;
  splits: Record<
    "train" | "validation" | "test",
    { n: number; start: string; end: string; match_ids: number[] }
  >;
  models: Record<
    string,
    { name: string; validation: ModelEvaluation; test: ModelEvaluation }
  >;
  important_features: { feature: string; label: string; importance: number }[];
  importance_method: string;
  test_comparison: {
    log_loss_improvement_over_prior: number;
    accuracy_improvement_over_prior: number;
    interpretation: string;
  };
  leakage_prevention: string[];
  limitations: string[];
}
export interface Prediction {
  team: Club;
  context: {
    mode: string;
    match_id: number | null;
    match_date: string | null;
    opponent: Club;
    is_home: boolean;
    latest_feature_date: string;
    feature_match_ids: number[];
  };
  probabilities: Probabilities;
  model_name: string;
  evaluation: ModelEvaluation;
  important_features: ModelMetrics["important_features"];
  limitations: string[];
  measured: string;
}
export interface TacticalScenario {
  id: string;
  title: string;
  shot_volume_change: number;
  shot_quality_change: number;
  attack_xg_change: number;
  xga_reduction: number;
}
export interface ScenarioResult {
  id: string;
  title: string;
  assumptions: Record<string, number>;
  attack_xg: number;
  defense_xg: number;
  probabilities: Probabilities & { expected_points: number };
  delta_expected_points: number;
  sensitivity: {
    assumption_factor: number;
    expected_points: number;
    clipped_to_input_limits: boolean;
  }[];
  interventions: number;
  eligible: boolean;
  priority_score: number;
  evidence_ids: string[];
  uncertainty: string;
}
export interface Simulation {
  team_id: number;
  opponent_id: number | null;
  baseline: {
    team: Club;
    opponent: Club | null;
    is_home: boolean;
    as_of: string | null;
    mode: string;
    attack_xg: number;
    defense_xg: number;
    probabilities: Probabilities & { expected_points: number };
    sample_size: number;
    opponent_sample_size: number;
    confidence_intervals: Record<string, number[]>;
    evidence: Evidence[];
    match_ids: number[];
    method: string;
    uncertainty: string;
  };
  scenarios: ScenarioResult[];
  planning: {
    priority: string;
    max_interventions: number;
    priority_strength: number;
    score_definition: string;
  };
  limitations: string[];
}
export interface Recommendation {
  id: string;
  supporting_match_id: number;
  evidence_match_criterion: string;
  evidence_quality: {
    reliability: number;
    sample_size: number;
    cluster_clubs: number | null;
    note: string;
  };
  title: string;
  diagnosed_problem: string;
  status: string;
  evidence_ids: string[];
  supporting_metrics: Evidence[];
  experiment: string;
  evaluation_plan: string;
  scenario_id: string;
  scenario_assumptions: Record<string, number>;
  modeled_delta_expected_points: number;
  modeled_sensitivity: ScenarioResult["sensitivity"];
  interventions: number;
  eligible: boolean;
  score: number;
  score_components: Record<string, number>;
  score_sensitivity: { gain_weight: number; score: number }[];
  risks: string[];
  uncertainty: string[];
  selected_for_testing: boolean;
  opponent_context: StyleGroup | null;
}
export interface Advisor {
  diagnosis: CoachSnapshot;
  team: Club;
  opponent: Club | null;
  selected_scenario_id: string | null;
  recommendations: Recommendation[];
  evidence: Evidence[];
  simulation: Simulation;
  ranking: {
    weights: Record<string, number>;
    definition: string;
    components: Record<string, string>;
    max_interventions: number;
    resource_assumption: string;
  };
  model_context: {
    model_name: string;
    test_comparison: ModelMetrics["test_comparison"];
    note: string;
  };
  measured: string;
  modeled: string;
  limitations: string[];
}
export interface Meta {
  name: string;
  modules: string[];
  definitions: Record<string, string>;
  metric_labels: Record<string, string>;
  limitations: string[];
  attribution: string;
  coverage: {
    source: string;
    source_url: string;
    revision: string;
    matches: number;
    clubs: number;
    events_and_lineups_matches: number;
    shot_xg_completeness: number;
    score_reconciled_matches: number;
    quality_counts: Record<string, number>;
    cleaning_decisions: string[];
  };
}
export interface HistoricalContext {
  teamId: number;
  matchId: number;
  opponentId: number;
  date: string;
  isHome: boolean;
}

export interface CoachSnapshot {
  match_selection?: {
    match_id: number;
    match_ids: number[];
    metric: string;
    value: number;
    reference: number;
    criterion: string;
  };
  title: string;
  text: string;
  metric: string;
  evidence_id: string;
  match_id: number;
  scope: string;
  observations: Research["findings"];
  evidence?: Evidence[];
  outcome_comparison?: { metric: string; without_win: number; wins: number; without_win_n: number; wins_n: number }[];
}
export interface MatchReview {
  title: string;
  result: string;
  issue: string;
  xg_leader: number | null;
  xg_comparison: { category: "balanced" | "moderate" | "substantial"; difference: number; issue: string; note: string };
  patterns: string[];
  dangerous_event_ids: string[];
  central_event_ids: string[];
  low_quality_event_ids: string[];
  note: string;
}
export interface OpponentReview {
  comparisons: {
    metric: string;
    label: string;
    value: number;
    benchmark: number;
    team_value: number;
    status: "parity" | "uncertain" | "higher" | "lower";
    sample_size: number;
    mean_interval: [number,number] | null;
    interpretation: string;
  }[];
  strengths: OpponentReview["comparisons"];
  vulnerabilities: OpponentReview["comparisons"];
  neutral: OpponentReview["comparisons"];
  method: string;
  question: string;
  match_ids: number[];
  note: string;
}
export interface AIAnalysis {
  analysis_id: string;
  team_id: number;
  opponent_id: number;
  model: string;
  cached: boolean;
  analysis: {
    main_conclusion: string;
    recommendation: string;
    unverified: boolean;
    why: { text: string; evidence_ids: string[] }[];
    alternatives: { text: string; evidence_ids: string[] }[];
    risks: string[];
    evaluation_plan: string[];
    missing_evidence: string[];
  };
  evidence: Evidence[];
  scenario: ScenarioResult;
  baseline: Simulation["baseline"];
  scope_note: string;
}
export interface CoachingBrief {
  created_at: string;
  team: Club;
  opponent: Club | null;
  season: string;
  is_home: boolean;
  as_of: string | null;
  match_id: number | null;
  diagnosis: CoachSnapshot;
  supporting_match: { date: string; opponent: Club; goals_for: number; goals_against: number };
  recommendation: Pick<
    Recommendation,
    "id" | "title" | "experiment" | "evaluation_plan" | "risks" | "diagnosed_problem" | "status"
  >;
  baseline: Simulation["baseline"];
  scenario: ScenarioResult;
  evidence: Evidence[];
  alternatives: {
    title: string;
    experiment: string;
    modeled_delta_expected_points: number;
  }[];
  limitations: string[];
  source: string;
  source_revision: string;
}
export interface SavedScenario {
  storageId: string;
  name: string;
  savedAt: string;
  clubId: number;
  opponentId: number;
  matchId: number | null;
  historicalContext: HistoricalContext | null;
  isHome: boolean;
  scenario: TacticalScenario;
  priority: Priority;
  maxInterventions: number;
  priorityStrength: number;
}
