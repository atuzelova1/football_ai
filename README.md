# Football AI — Тактический интеллект

## Project Overview

Football AI helps a coaching staff investigate why a club loses points and decide which tactical experiment to test next. A coach can inspect the matches behind a finding, compare an opponent, change explicit performance assumptions and prepare a short coaching brief.

This Russian-language university project implements **Laboratory Work #2, Scenario 4 — Tactical Laboratory, Level 3 — Decision Intelligence**. Its decision component compares alternatives under a one- or two-intervention planning constraint, with supporting evidence, assumptions, sensitivity and an evaluation plan.

The research question is: **Why does the selected club lose points, and which tactical improvements should its coaching staff prioritize testing?** All observations concern La Liga 2015/16, not current football.

The backend uses Python, FastAPI/Uvicorn, pandas, NumPy, SciPy, scikit-learn, SQLite and joblib. The frontend uses React, TypeScript, Vite, Tailwind CSS, Recharts, Lucide and React Router. Pytest and Vitest/React Testing Library cover the scientific and application workflows.

## Main Features

| Screen | What the coach does |
| --- | --- |
| **Coach Dashboard — Панель тренера** | Review season results, the main calculated diagnosis, league benchmarks and relevant matches. Expand the research section for four statistical hypotheses. |
| **Match Review — Разбор матчей** | Filter fixtures, inspect real shot locations and the xG timeline, and select evidence. Passing and defensive-event details are available on demand. |
| **Opponent Preparation — Подготовка к сопернику** | Compare direct indicators and head-to-head matches. Explore statistical profile similarity and eligible historical predictions in expandable sections. |
| **Tactical Plan — Тактический план** | Compare scenarios, adjust assumptions and resource priorities, review recommendations, optionally ask OpenAI a question and print a coaching brief. |

All **20 clubs** are supported. Club, opponent, match, cutoff, scenario and evidence selections are shared. The six underlying engines—team analytics, match analysis, opponent intelligence, classification, simulation and recommendations—remain available through FastAPI. **Methodology and Data — Методология и данные** explains definitions, validation and limitations without repeating them on each card.

## Data and Preparation

Source: [Hudl / StatsBomb Open Data](https://github.com/hudl/open-data), pinned to revision `4b73468fc5b0f1950f9f66fada70ad3a4f9327cb`. Competition ID **11**, season ID **27**, Spanish La Liga **2015/2016**.

The prepared database contains **380 fixtures, 20 clubs and 760 team-match records**, with 38 fixtures per club. Preparation processed **1,295,354 events, 9,168 shots and 365,288 passes**, with events and lineups for every fixture. All shots have xG and all 380 scores reconcile with shot goals and own goals.

The pipeline reads `competitions.json`, `matches/11/27.json`, `events/{match_id}.json` and `lineups/{match_id}.json`. It downloads only this season, retries failed downloads, caches files by revision and processes matches incrementally. Exact duplicate events are removed; conflicting IDs, invalid scores and inconsistent relationships fail validation. Rare genuine events remain. The 29 own goals are counted once despite paired source events. Missing coordinates are not invented: 17 passes lack valid coordinate pairs and remain in totals while being excluded from spatial calculations. Unknown pass outcomes are retained and not counted as completed passes.

Key operational definitions:

- **xG:** sum of StatsBomb shot probabilities, including penalties. Own goals do not receive shot xG. **xGA** is the opponent's shot xG; **xG difference** is xG minus xGA.
- **Shot quality:** total season xG / total shots. Result comparisons and style profiles average match-level ratios, so aggregations can differ.
- **Dangerous shot:** xG at least 0.20. The central-box zone is `x >= 102`, `18 <= y <= 62` on StatsBomb's 120 × 80 pitch. These are operational thresholds.
- **Progressive pass:** a completed pass reducing distance to `(120, 40)` by at least 25% and 10 pitch units.
- **Pass accuracy:** completed passes / attempts. **Pass share** is a possession-related event proxy, not measured possession time.
- **Points short of the maximum:** `3 × matches − points`, not points lost from winning positions.

SQLite stores the compact derived records and reusable research results. The approximately **8.1 MB database** and two small joblib assets are included. Normal startup does not download raw data or train models. Raw events and caches are excluded from Git.

To explicitly reproduce preparation and model training, stop the application and run from the root:

```powershell
.\.venv\Scripts\python.exe backend\scripts\prepare_data.py
```

Cached files and processed matches are reused. To rebuild SQLite from the pinned source:

```powershell
.\.venv\Scripts\python.exe backend\scripts\prepare_data.py --rebuild
```

Both commands prepare research, clustering and prediction assets. Internet access is needed when the ignored cache is absent. `setup.ps1 -PrepareData` explicitly prepares data after installation; ordinary startup skips it.

## Analytical Methods and Models

Season research compares results, shot volume and quality, defensive exposure, venue and league benchmarks. Four per-club hypotheses examine xG difference and shot quality in wins versus losses, paired home/away differences against the same opponents, and the Spearman association between xGA and points short of the maximum. Permutation tests, effect sizes and bootstrap intervals accompany results; Holm correction applies to the four tests within a club. Wider cross-club exploration remains exploratory.

Opponent similarity uses **StandardScaler + K-Means** on seven event-derived indicators. Counts `k=2..5` are evaluated using silhouette and group sizes. The current two-group solution has **18 and 2 clubs**, silhouette **0.6218**, and fails the preferred minimum group size. A separate diagnostic uses **120 non-overlapping six-match profiles**. These profiles are confounded with team strength; direct matchup indicators take priority over small-cluster advice.

Match outcome prediction compares a prior-frequency **DummyClassifier**, **Logistic Regression** and **Random Forest**. It predicts loss/draw/win from the home team's perspective and reverses probabilities for the away club. Features summarize the latest five strictly earlier fixtures: goals, xG/xGA, points, shots, passing and defensive indicators. Each fixture contributes one observation and requires at least three earlier matches per team.

The simulator is separate from the classifier. Venue-specific team attack and opponent defence are shrunk toward the league with a five-match prior. Their averages supply independent Poisson goal parameters:

```text
Expected points = 3 × P(win) + P(draw)
Attack xG = baseline xG × (1 + shot-volume change) × (1 + shot-quality change)
Defensive xG = baseline xGA × (1 − xGA reduction)
```

A direct attacking-xG change is an alternative to volume/quality changes; simultaneous use is rejected. Adaptive truncation controls probability tails. Sensitivity compares half, original and one-and-a-half assumptions within the input bounds. Bootstrap baseline intervals describe historical averages, not tactical treatment effects.

The deterministic advisor ranks coaching hypotheses using diagnosed deficits, evidence quality, sample support, assumed gain and user priorities. Small or confounded groups receive penalties. Supporting matches are selected using relevant deviations, rather than an arbitrary first fixture. Ranking scores are planning aids, not intervention-success probabilities.

Optional OpenAI analysis receives a bounded summary of clubs, period, verified evidence, historical examples, scenarios, limitations and the coach's question. It writes qualitative advice; backend code supplies football numbers and scenario outcomes. Strict parsing, text checks and evidence-ID validation reject unsupported output. For **gpt-4.1-mini**, v5 uses **Chat Completions with Structured Outputs**; other supported configured models use Responses. HTTP/2 is enabled, TLS verification remains on and automatic SDK retries are disabled.

## Evaluation and Reproducibility

The saved production model is **Logistic Regression**, selected by validation log loss. Preprocessing is fitted inside the training pipeline. Current-match score, shots, xG, final standings and full-season clusters do not enter that fixture's features.

| Split | Fixtures | Dates |
| --- | ---: | --- |
| Training | 211 | 2015-09-18–2016-02-19 |
| Validation | 69 | 2016-02-20–2016-04-04 |
| Test | 70 | 2016-04-08–2016-05-15 |

After selection, models are refitted on training + validation. Evaluation is sequential: completed earlier test fixtures can inform later fixtures. Excluding early fixtures leaves 350 observations. Historical predictions presented as unseen are restricted to the test IDs.

| Model | Validation log loss | Test accuracy | Test macro F1 | Test log loss | Test Brier score |
| --- | ---: | ---: | ---: | ---: | ---: |
| Prior baseline | 1.1347 | 54.29% | 0.2346 | 1.0088 | 0.6037 |
| **Logistic Regression** | **1.0473** | **55.71%** | **0.4373** | **1.0330** | **0.6059** |
| Random Forest | 1.0985 | 52.86% | 0.3940 | 0.9824 | 0.5820 |

The selected model **does not outperform the baseline on test probability quality**. Draw precision is **22.22%**, recall **15.38%**, on 13 draws. The forest's better test log loss does not justify selecting it after inspecting this same test set. Calibration is diagnostic, not tuned on test fixtures. The optional `backend/scripts/experiment_prediction.py` uses expanding-window validation without replacing production assets; `--include-known-test` explicitly labels the already inspected test set.

Software tests verify calculations, selections, chronological boundaries, scenarios and AI validation. Passing them is distinct from predictive accuracy. A real integration check with **gpt-4.1-mini** returned HTTP 200, `finish_reason=stop`, and **five validated evidence IDs** through the frontend proxy. It used 3,642 prompt and 290 completion tokens. An earlier connection attempt failed; HTTP/2 subsequently completed the request. No live request runs during startup or automated tests. Valid citations do not prove every tactical interpretation.

Final release checks passed: **153 backend tests, 16 frontend/DOM tests, TypeScript checking and the production build**. The existing `setup.ps1` installation and `start.ps1 -SmokeTest -NoBrowser` startup/proxy checks also completed successfully. The AI scenario regression checks that a defensive recommendation is not presented as the source of a negative shot-quality scenario result, and that changing assumptions clears the old analysis. No additional paid call was used for this release verification.

## Installation and Quick Start

Use **Windows PowerShell**, **Python 3.11–3.13** on PATH, and **Node.js 22 or 24+ with npm**. The release environment uses Python 3.12 and Node.js 22. Python requirements include the OpenAI SDK, `httpx2` and `h2` for HTTP/2. First setup needs PyPI/npm access.

```powershell
git clone https://github.com/atuzelova1/football_ai.git
cd football_ai
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Setup
```

`-Setup` installs dependencies and checks bundled data/models. Later launches do not install or retrain:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

Open **http://127.0.0.1:5173**. API documentation: **http://127.0.0.1:8000/api/docs**. Keep the launcher terminal open; **Ctrl+C stops both servers**. `-NoBrowser` prevents automatic browser opening. This smoke check starts both servers, checks health and proxy, then stops them:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -SmokeTest -NoBrowser
```

For development after setup, use two terminals, stopping each with Ctrl+C:

```powershell
# Terminal 1, starting at the repository root
cd backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```powershell
# Terminal 2, starting at the repository root
cd frontend
npm.cmd run dev
```

## Environment Configuration

No key is required for analytics, predictions, simulation, deterministic recommendations or printing. For external AI, create the local root file and edit it yourself:

```powershell
Copy-Item .env.example .env
notepad .env
```

Do not overwrite an existing configured `.env`. Example:

```dotenv
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
OPENAI_MODEL=gpt-4.1-mini
OPENAI_MAX_OUTPUT_TOKENS=3500
```

`OPENAI_MODEL` must contain only the model ID, without commentary or internal spaces. Its code default is `gpt-5-mini`; the template explicitly selects the verified `gpt-4.1-mini`. `OPENAI_MAX_OUTPUT_TOKENS` accepts 1500–6000 and becomes `max_completion_tokens` for Chat Completions. Optional `OPENAI_ORG_ID` and `OPENAI_PROJECT_ID` are read by the SDK when an explicit scope override is needed. Omit unused identifiers.

The backend loads root `.env` with **override=False**: inherited terminal variables take precedence. Restart after changes. `GET /api/advisor/ai/status` reports the effective model, integration version, source freshness and safe error diagnostics without contacting OpenAI. A configured key alone does not prove access or billing availability.

`.env` is ignored; `.env.example` contains no secret. Never put keys in `VITE_` variables, frontend code, questions, scenarios or commits. Keep servers on loopback. Local client/origin/header checks are demo safeguards, not public-service authentication. The backend limits concurrent calls and request frequency, caches identical answers for five minutes and retains follow-up context for ten minutes. External calls may incur charges and require an explicit UI action.

## Example Workflow

1. In **Панель тренера**, select **Райо Вальекано**. The dashboard covers the entire 2015/16 season. Inspect its defensive diagnosis and supporting fixtures.
2. In **Разбор матчей**, select the home match against **Реал Мадрид on 23 April 2016**. Inspect real shots and the xG timeline. These events describe the completed match, not pre-kickoff knowledge.
3. In **Подготовка к сопернику**, expand **Историческая оценка исхода** and select that eligible fixture in **Контекст прогноза**. The linked plan now uses only matches before **2016-04-23**; the season dashboard remains a separate retrospective view.
4. In **Тактический план**, choose **Снижение опасности**, set **Снижение xGA** to **+10%**, and compare creation and shot-quality alternatives under the same opponent, venue and cutoff.
5. This baseline gives **1.312 expected points**; the defensive assumption gives **1.411**, a modeled difference of **+0.100 points per match**. It is a what-if result, not an observed training benefit.
6. Inspect the leading recommendation and its evidence. Before the cutoff, Rayo's xGA per fixture is **1.610**, against **1.279** for other clubs. A real OpenAI check suggested testing coordinated movement of the holding midfielder and central defenders as the opponent enters the box. It identified exposed flanks as a risk and monitoring central chances in subsequent matches as the evaluation plan.
7. If configured, ask your own question with **Проанализировать с AI**. Wording can vary. The separately labeled scenario result names the assumption being evaluated, even if textual advice proposes another experiment. Changing club, opponent, match or parameters invalidates the old analysis.
8. Select a recommendation for **Тренерская сводка**, inspect its scenario, evidence and risks, then use **Печать / Сохранить в PDF**. This opens the browser print dialog; no PDF is generated automatically.

## Testing and Troubleshooting

Backend checks, starting from the root:

```powershell
Push-Location backend
..\.venv\Scripts\python.exe -m pytest -q
Pop-Location
```

With the backend running on port 8000, run frontend checks:

```powershell
cd frontend
npm.cmd test
npx.cmd tsc -b
npm.cmd run build
```

Frontend integration tests use real local football APIs and mock external AI calls/status. Their guard prevents paid calls even when the server has a key. DOM workflows cover four screens, club selection, shots, predictions, scenarios, recommendations, evidence links and print invocation. DOM checks do not establish browser rendering or exported PDF pagination.

| Problem | Action |
| --- | --- |
| Missing dependencies | Run `setup.ps1` once. Use `npm.cmd` if PowerShell blocks `npm.ps1`. |
| Occupied port | Use `Get-NetTCPConnection -State Listen -LocalPort 8000,5173` to identify its owner; stop only your previous project server. |
| Model differs from `.env` | Correct/remove the inherited `OPENAI_MODEL` override in the launcher terminal, then restart. |
| `configuration.model` | Remove extra words or internal spaces from the model value. |
| `provider.model` | OpenAI explicitly reported `model_not_found`; check the ID and project access. Other 404s have separate codes. |
| Access/quota error | Check billing, model permissions and optional organization/project overrides. |
| Transport error or incomplete output | Read the specific safe diagnostic. Setup installs HTTP/2; do not disable TLS. An interrupted call may still have been processed, so retries are manual. |
| Invalid evidence/numeric claims | The response is rejected. Use deterministic recommendations; do not bypass validation. |

## Limitations and AI Usage

There are only 38 fixtures per club and smaller matchup/result groups. Team strength, personnel, schedule and game state can confound associations. Correlation is not causation. Tracking, running distances, measured compactness, video interpretation and current squads are unavailable.

StatsBomb supplies xG estimates; their training provenance is outside this project's control. Full-season profiles do not enter pre-match prediction. Bootstrap independence and independent Poisson goals are approximations. Slider changes do not prove that a tactical instruction can achieve them. Coaches must choose feasible experiments and evaluate subsequent matches, including failures.

The rule-based advisor works without an LLM. OpenAI optionally summarizes verified context; deterministic code supplies numbers. Structural and citation checks reduce unsupported output but cannot guarantee correct tactical reasoning. OpenAI Codex assisted with development, revisions, tests and documentation. Coverage and saved model metrics come from executed code and real prepared assets.

## Repository Structure and Data Attribution

```text
backend/
  app/                  FastAPI, six analytical engines, coaching and LLM integration
  scripts/              Pinned data preparation and optional prediction experiment
  data/football.sqlite  Compact real derived snapshot
  models/               Saved outcome and style pipelines
  tests/                Scientific, functional and mocked provider checks
  requirements.txt
frontend/
  src/                  Four-screen React app, shared context and DOM tests
  public/               Product mark and StatsBomb logo
  package.json
  package-lock.json
.env.example
setup.ps1
start.ps1
README.md
```

<img src="frontend/public/statsbomb.png" alt="StatsBomb" width="190" />

Data and xG: **StatsBomb Open Data, maintained by Hudl**. Refer to the [source repository](https://github.com/hudl/open-data), [attribution instructions](https://github.com/hudl/open-data#terms--conditions), and [license at the pinned revision](https://github.com/hudl/open-data/blob/4b73468fc5b0f1950f9f66fada70ad3a4f9327cb/LICENSE.pdf). Preserve source acknowledgement and the StatsBomb logo when sharing derived analysis. The data and logo retain their upstream terms; this README grants no additional rights or endorsement.
