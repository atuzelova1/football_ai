# Football AI — Тактический интеллект

A Russian-language football research and decision-support platform for coaching staff. It connects historical match evidence to tactical hypotheses, compares alternatives and explains how to evaluate the proposed changes.

**Laboratory Work #2 · Scenario #4: Tactical Laboratory · Level #3: Decision Intelligence.**

## Research question

**Why does a selected football club lose points, and which tactical improvements should its coaching staff prioritize testing?**

The platform supports every club in the prepared season. It is historical research, not a current forecasting or betting service.

## Six connected modules

| Module | What it provides |
| --- | --- |
| Обзор команды | Season results, xG/xGA, league comparisons, home/away form, findings and four statistical hypotheses. |
| Анализ матчей | Result and venue filters, real SVG shot maps, player-level shot tooltips, cumulative xG, shooting zones and passing patterns. |
| Анализ соперников | Standardized K-Means profiles, similar opponents, normalized comparisons and results against opponent groups. |
| ML-прогноз | Eligible held-out historical predictions, hypothetical historical comparisons, model evaluation and baseline comparison. |
| Симулятор | Interactive assumptions, Poisson outcome probabilities, expected points, alternative scenarios and sensitivity. |
| AI-советник | Specific tactical experiments with metrics, match evidence, modeled benefit, transparent priority scores, risks and evaluation plans. |

Club, opponent, match, historical prediction context, scenario and evidence selections are shared. Relevant IDs are included in navigation URLs; changing clubs clears incompatible selections.

**Workflow:** select a club → inspect a finding → open a supporting match → examine its opponent → evaluate an eligible historical prediction → compare scenarios → send the selected assumptions to the advisor → return to the supporting evidence.

The five research stages—problem, data, analytics/AI, validation and decision—are visible inside the application, including the methodology drawer.

## Real data and attribution

<img src="frontend/public/statsbomb.png" alt="StatsBomb" width="190" />

Data and the supplied shot-quality model are from [StatsBomb Open Data](https://github.com/hudl/open-data), maintained by Hudl. Dataset and logo retain the [upstream terms](https://github.com/hudl/open-data/blob/4b73468fc5b0f1950f9f66fada70ad3a4f9327cb/LICENSE.pdf); preserve StatsBomb attribution when sharing derived work.

- Spanish La Liga **2015/2016**, competition **11**, season **27**.
- Pinned source revision: `4b73468fc5b0f1950f9f66fada70ad3a4f9327cb`.
- **380 fixtures, 20 clubs, 760 team-match rows**, with 38 matches per club.
- **1,295,354 events, 9,168 shots and 365,288 passes** processed.
- All shots contain xG; every match score is reconciled with shot goals and own goals. **29 own goals** are counted once despite paired source events.
- Seventeen passes have missing/invalid coordinate pairs; they remain in pass totals but are excluded from spatial calculations. Unknown pass outcomes are preserved and are not counted as completed passes.

The repository includes one approximately **8.1 MB SQLite snapshot** and two small joblib assets. Raw event downloads, environments, dependencies and generated builds are excluded. The prepared application needs no data API key, paid API or repeated raw-data download.

## Technology and structure

Python, FastAPI/Uvicorn, pandas, NumPy, SciPy, scikit-learn, SQLite, joblib and pytest; React, TypeScript, Vite, Tailwind CSS, Recharts, Lucide and React Router. Football/statistical calculations run in Python; React visualizes the returned results.

```text
backend/
  app/                 API, shared data, analytics, prediction, scenarios and advisor
  scripts/prepare_data.py
  data/football.sqlite
  models/              outcome.joblib and styles.joblib
  tests/
  requirements.txt
frontend/
  src/                 shared state, typed API client, components and six pages
  public/              original product mark and StatsBomb attribution asset
  package.json
  package-lock.json
setup.ps1
start.ps1
```

## Windows installation and startup

Prerequisites: **Python 3.11–3.13** on PATH, **Node.js 22 LTS or 24+**, and npm. Verified with Python 3.12.10, Node.js 22.12.0 and Windows PowerShell. Use `npm.cmd` if your PowerShell execution policy blocks `npm.ps1`.

From a fresh clone:

```powershell
git clone https://github.com/atuzelova1/football_ai.git
cd football_ai
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Setup
```

The explicit `-Setup` step installs dependencies and uses the bundled prepared snapshot. Internet access to PyPI/npm is needed for first installation. Later launches do not install packages or train models:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

Open **http://127.0.0.1:5173**. API documentation: **http://127.0.0.1:8000/api/docs**. Keep the launcher terminal open; **Ctrl+C stops both servers**. The script checks occupied ports and readiness, and reports setup failures. Add `-NoBrowser` to prevent automatic browser opening.

Startup verification without leaving servers running:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -SmokeTest -NoBrowser
```

For development, use two terminals after setup:

```powershell
# Terminal 1, from the repository root
cd backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

```powershell
# Terminal 2, from the repository root
cd frontend
npm.cmd run dev
```

## Data preparation and model training

Normal demonstration startup uses the included snapshot. To re-run preparation and training explicitly, from the root:

```powershell
.\.venv\Scripts\python.exe backend\scripts\prepare_data.py
```

The pipeline validates metadata, downloads only the requested season's events/lineups when needed, caches downloads under the pinned revision, processes one match at a time and prepares SQLite, clustering, prediction pipelines and reusable research results. Retries and progress are printed to the console.

To rebuild the database from original source files:

```powershell
.\.venv\Scripts\python.exe backend\scripts\prepare_data.py --rebuild
```

This explicit rebuild requires internet access if the ignored source cache is absent and can take several minutes. Existing cached files are reused. Stop the application before rebuilding. `setup.ps1 -PrepareData` also explicitly runs the preparation pipeline after installing dependencies.

## Validated ML results

Each fixture contributes **one home-perspective training row**. Features use the most recent five strictly earlier matches, with at least three available. Early fixtures without enough history are excluded. Home/away perspectives are reversed only when presenting probabilities to the selected club.

| Split | Fixtures | Dates |
| --- | ---: | --- |
| Training | 211 | 2015-09-18–2016-02-19 |
| Validation | 69 | 2016-02-20–2016-04-04 |
| Test | 70 | 2016-04-08–2016-05-15 |

The minimum **validation log loss** selects the model. Its preprocessing and estimator are then fitted on training + validation; test fixtures do not enter fitting. Test evaluation is sequential: earlier completed test fixtures can supply historical features for later fixtures.

Actual results on the **70 held-out fixtures**:

| Model | Accuracy | Macro F1 | Log loss | Multiclass Brier |
| --- | ---: | ---: | ---: | ---: |
| Prior-frequency baseline | 54.29% | 0.2346 | 1.0088 | 0.6037 |
| **Logistic Regression — selected** | **55.71%** | **0.4373** | **1.0330** | **0.6059** |
| Random Forest | 52.86% | 0.3940 | 0.9824 | 0.5820 |

Logistic Regression had the best validation log loss (**1.0473**, versus 1.1347 for the baseline and 1.0985 for the forest). It **did not beat the baseline on test log loss**. The forest's lower test log loss is reported without changing the already selected model. The selected model's bootstrap accuracy interval is approximately **44.3–67.1%**; repeated-team dependence limits this interval. Performance claims should remain modest.

The interface exposes confusion matrices, per-class metrics, important features and limitations. Historical fixtures used for fitting cannot be requested as unseen forecasts. Current scores, current xG/shots, season-end standings and retrospective style clusters are excluded from prediction features.

## Evidence-supported observations

Examples produced by the prepared research engine, not universal tactical conclusions:

- **Rayo Vallecano:** 13.18 shots per match versus 12.00 for the other clubs, but mean match-level shot quality of 0.100 versus 0.107. More shots did not imply better shots (`team:360:season:shots`, `team:360:season:shot_quality`).
- **Rayo Vallecano:** 90.5% of conceded xG came from the operational central-box zone, versus 87.3% for other clubs; total xGA was 1.58 per match. This motivates examining central defensive episodes, not claiming that compactness was measured or caused the results (`team:360:season:central_xga_share`).
- **Real Madrid:** 90 actual points versus 72.88 from the descriptive match-xG Poisson model. This discrepancy is neither proof of luck nor a causal measure of coaching quality (`team:220:season:points_minus_poisson`).

Season shot quality is total xG divided by total shots. Outcome comparisons and style profiles use the mean of match-level ratios; these aggregations can differ. The app documents this distinction.

Four hypotheses per club use permutation tests and bootstrap intervals: xG difference by result, shot quality by result, paired home/away xG difference against the same opponents, and Spearman association between xGA and dropped points. Holm correction applies to the four tests within a club. Broader cross-club exploration is not treated as confirmatory evidence.

K-Means evaluates standardized passing, shooting and defensive-event features for `k=2..5`. The selected descriptive solution has **two groups of 18 and 2 clubs**, silhouette **0.6228**. No candidate satisfied the preferred minimum of three clubs in every group; the interface warns about this. A separate **120 non-overlapping six-match block** diagnostic and bootstrap stability checks are available. Stable labels do not establish reliable tactical types.

## Scenario modeling and decision prioritization

The baseline averages the selected club's attacking xG with the opponent's xGA, and the club's xGA with the opponent's attacking xG. Venue-specific historical averages are shrunk toward the league with a five-match prior. A supplied historical cutoff excludes matches on or after that date.

Independent Poisson goal counts give win/draw/loss probabilities and:

```text
Expected points = 3 × P(win) + P(draw)
Attack xG = baseline xG × (1 + shot-volume change) × (1 + shot-quality change)
Defensive xG = baseline xGA × (1 − xGA reduction)
```

A direct attacking-xG change is an alternative to the volume/quality transformation; the API rejects their simultaneous use. Adaptive numerical truncation controls probability tails. The app compares at least three alternatives, baseline bootstrap intervals and sensitivity at half/original/one-and-a-half assumptions, bounded by the input limits.

The coach selects an attacking/defensive/balanced priority, its weight and a one- or two-intervention resource limit. Advisor ranking combines diagnosed deficits, modeled gain, sample support and priority alignment; weights and sensitivity are shown. Scores are planning heuristics, **not probabilities of success**. Scenario assumptions are passed to the advisor and remain linked to real metrics and match IDs.

An assumed 10% xG improvement does not establish that a specific tactical instruction will produce it. Recommendations include practical experiments, risks and a subsequent-match/video evaluation plan.

## Verification and limitations

Executed checks include **35 backend tests**, **7 React DOM integration tests using the real FastAPI service**, TypeScript checking, production builds, HTTP workflows for all 20 clubs, independent reconciliation against all 380 pinned source event files, and installation/startup from a clean committed copy.

The DOM workflows cover Barcelona, Real Madrid, Atlético Madrid, Athletic Club and Villarreal, plus selection of all 20 clubs and club changes inside every module. They verify shot markers, eligible historical predictions, changed scenario results, advisor assumptions, evidence navigation and persisted context. **DOM tests are not browser tests; live browser/mobile visual verification remains unconfirmed.**

After setup, run backend checks from `backend`:

```powershell
..\.venv\Scripts\python.exe -m pytest -q
```

With FastAPI running, run frontend checks from `frontend`:

```powershell
npm.cmd test
npm.cmd run build
```

Important limits:

- One historical season, 38 matches per club and small opponent/result subgroups; results do not describe current squads.
- Correlation is not causation. Calendar, opponent strength, game state and personnel can confound observed relationships.
- Pass share is an event-derived control proxy, not measured possession time. There is no player tracking, running speed, distance or measured compactness.
- StatsBomb xG is an external retrospective quality estimate. Its original model training provenance is outside this project's control.
- Retrospective full-season research and opponent clusters are separated from historical pre-match features. Advisor diagnosis remains retrospective even when a scenario baseline uses an earlier cutoff.
- Poisson independence, bootstrap exchangeability and assumed parameter improvements are approximations. Sensitivity ranges are not confidence intervals for tactical treatment effects.

## AI-assistance disclosure

OpenAI Codex assisted with implementation, revision, tests and this README. Football results and evaluation metrics were calculated by executing the real-data pipeline. The advisor is a transparent rule-based recommendation engine; it does not require a paid LLM or API credentials.
