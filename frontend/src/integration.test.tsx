import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { AppProvider } from "./context";
import type {
  Advisor,
  Club,
  MatchAnalysis,
  Prediction,
  Simulation,
} from "./types";
import { clubName, metricValue, pct, signed } from "./format";
import { validSaved } from "./savedScenarios";
import type { AIAnalysis, CoachingBrief } from "./types";

const nativeFetch = globalThis.fetch;
const requests: {
  path: string;
  body: Record<string, unknown> | undefined;
  response: unknown;
}[] = [];
beforeAll(() => {
  configure({ asyncUtilTimeout: 20000 });
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      // Наличие настоящего ключа у локального backend не должно менять тест
      // fallback или разрешать случайную платную генерацию. AI-ответы ниже
      // подменяются явно в отдельных тестах; футбольная аналитика остаётся реальной.
      if (path === "/api/advisor/ai/status")
        return new Response(JSON.stringify({ available: false, model: null,
          message: "Внешний AI не подключён. Рекомендации по данным доступны без ключа.",
          source_is_current: true, integration_version: "test" }));
      if (path === "/api/advisor/ai")
        throw new Error("Платные AI-запросы запрещены в автоматических frontend-тестах.");
      const response = await nativeFetch(
        new URL(path, "http://127.0.0.1:8000"),
        init,
      );
      const data = await response.clone().json();
      requests.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        response: data,
      });
      return response;
    },
  );
  // jsdom не рассчитывает геометрию. Размер задаётся только тестовой средой,
  // чтобы библиотека нарисовала SVG; это не проверка браузерной компоновки.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: { width: 720, height: 280 },
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  window.scrollTo = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 720,
    height: 280,
    top: 0,
    left: 0,
    right: 720,
    bottom: 280,
    toJSON() {
      return {};
    },
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});
function latest<T>(path: string) {
  return requests
    .filter((r) =>
      path.endsWith("/")
        ? r.path.startsWith(path)
        : r.path.split("?")[0] === path,
    )
    .at(-1)?.response as T | undefined;
}
function launch() {
  window.history.replaceState({}, "", "/overview");
  return render(
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>,
  );
}
async function navigate(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(
    within(
      screen.getByRole("navigation", { name: "Основная навигация" }),
    ).getByRole("button", { name: new RegExp(name) }),
  );
}

describe("Четыре тренерских раздела с реальным FastAPI: DOM, не браузер", () => {
  it.each([360, 217, 220, 212])(
    "проходит путь от диагноза до плана: клуб %s",
    async (tid) => {
      const user = userEvent.setup();
      launch();
      await screen.findByRole("heading", { name: "Панель тренера" });
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Выберите клуб" }),
        String(tid),
      );
      await waitFor(() =>
        expect(
          document.querySelector(".club-hero")?.getAttribute("data-team-id"),
        ).toBe(String(tid)),
      );
      expect(
        within(
          screen.getByRole("navigation", { name: "Основная навигация" }),
        ).getAllByRole("button"),
      ).toHaveLength(4);
      expect(
        screen.queryByRole("navigation", {
          name: "Путь к тренерскому решению",
        }),
      ).toBeNull();
      expect(
        screen.getByRole("region", { name: "Главный вывод по команде" }),
      ).toBeTruthy();
      await waitFor(() =>
        expect(
          (
            screen.getByRole("button", {
              name: "Разобрать матч-доказательство",
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(false),
      );
      await user.click(
        screen.getByRole("button", { name: "Разобрать матч-доказательство" }),
      );
      await screen.findByRole("heading", {
        name: "Почему этот матч заслуживает внимания?",
      });
      await screen.findByRole("heading", { name: "География моментов" });
      const match = latest<MatchAnalysis>("/api/matches/")!;
      expect(match.team.team_id).toBe(tid);
      expect(document.querySelectorAll(".shot-marker").length).toBe(
        match.shots.filter((s) => s.x !== null && s.y !== null).length,
      );
      await user.click(
        screen.getByRole("button", { name: "Опасные допущенные" }),
      );
      expect(document.querySelectorAll(".shot-marker").length).toBe(
        match.visuals.coaching.dangerous_event_ids.length,
      );
      await user.click(screen.getByRole("button", { name: "Все удары" }));
      await user.click(
        screen.getByRole("button", { name: "Анализировать соперника" }),
      );
      await screen.findByRole("heading", {
        name: "Что учитывать против этого соперника",
      });
      expect(
        document.querySelector(".opponent-hero")?.getAttribute("data-team-id"),
      ).toBe(String(tid));
      expect(
        (
          screen
            .getByText("Сходство игровых профилей")
            .closest("details") as HTMLDetailsElement
        ).open,
      ).toBe(false);
      await user.click(
        screen.getByRole("button", { name: "Посмотреть историческую оценку" }),
      );
      await screen.findByRole("heading", { name: "Предматчевый контекст" });
      await user.click(
        screen.getByRole("button", { name: "Взять матч тестовой выборки" }),
      );
      await waitFor(() =>
        expect(
          document
            .querySelector(".prediction-top")
            ?.getAttribute("data-team-id"),
        ).toBe(String(tid)),
      );
      const prediction = latest<Prediction>("/api/prediction")!;
      expect(prediction.context.match_id).not.toBeNull();
      expect(
        prediction.probabilities.win +
          prediction.probabilities.draw +
          prediction.probabilities.loss,
      ).toBeCloseTo(1, 10);
      await user.click(
        screen.getByRole("button", { name: "Перейти к тактическому плану" }),
      );
      await screen.findByRole("heading", { name: "Что меняется в модели" });
      expect(
        document.querySelectorAll(".scenario-compare-card").length,
      ).toBeGreaterThanOrEqual(3);
      fireEvent.change(
        screen.getByRole("slider", { name: "Среднее качество удара" }),
        { target: { value: "25" } },
      );
      await waitFor(() =>
        expect(
          latest<Simulation>("/api/simulation")?.scenarios.find(
            (s) => s.id === "quality",
          )?.assumptions.shot_quality_change,
        ).toBe(0.25),
      );
      await user.click(
        await screen.findByRole("button", { name: "Перейти к рекомендации" }),
      );
      await waitFor(() =>
        expect(
          document.querySelector(".recommendation-card h2"),
        ).not.toBeNull(),
      );
      const advice = latest<Advisor>("/api/advisor")!;
      expect(advice.team.team_id).toBe(tid);
      expect(
        advice.recommendations[0].evidence_match_criterion.length,
      ).toBeGreaterThan(20);
      const primary = document.querySelector(
        ".recommendation-card",
      ) as HTMLElement;
      await user.click(
        within(primary).getAllByRole("button", {
          name: /Показать доказательства/,
        })[0],
      );
      await screen.findByRole("heading", { name: "Выбранное доказательство" });
      expect(window.location.pathname).toBe("/overview");
      const selection = JSON.parse(
        localStorage.getItem("football-ai:selection")!,
      );
      expect(selection.selectedResearchEvidence.team_id).toBe(tid);
    },
  );

  it("начинает первый запуск с Райо и позволяет выбрать все 20 клубов", async () => {
    const user = userEvent.setup();
    launch();
    await screen.findByRole("heading", { name: "Райо Вальекано" });
    const clubs = requests.find((r) => r.path === "/api/clubs")!
      .response as Club[];
    for (const club of clubs) {
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Выберите клуб" }),
        String(club.team_id),
      );
      await waitFor(() =>
        expect(document.querySelector(".club-hero h2")?.textContent).toBe(
          clubName(club.name),
        ),
      );
      expect(
        JSON.parse(localStorage.getItem("football-ai:selection")!)
          .selectedMatchId,
      ).toBeNull();
    }
    cleanup();
    window.history.replaceState({}, "", "/overview");
    render(
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>,
    );
    await screen.findByRole("heading", { name: clubName(clubs.at(-1)!.name) });
  });

  it("сохраняет и восстанавливает параметры; формирует настоящую сводку и вызывает печать", async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      {},
      "",
      "/plan?club=360&opponent=220&match=3825886",
    );
    render(
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>,
    );
    await screen.findByRole("heading", { name: "Что меняется в модели" });
    fireEvent.change(
      screen.getByRole("slider", { name: "Среднее качество удара" }),
      { target: { value: "25" } },
    );
    await waitFor(() =>
      expect(
        latest<Simulation>("/api/simulation")?.scenarios.find(
          (s) => s.id === "quality",
        )?.assumptions.shot_quality_change,
      ).toBe(0.25),
    );
    await user.click(screen.getByText(/^Сохранённые сценарии/));
    await user.type(
      screen.getByRole("textbox", { name: "Название сохраняемого сценария" }),
      "Качество Райо",
    );
    await user.click(
      screen.getByRole("button", { name: "Сохранить сценарий" }),
    );
    expect(
      JSON.parse(localStorage.getItem("football-ai:scenarios:v1")!)[0]
        .historicalContext.date,
    ).toBe("2016-04-23");
    fireEvent.change(
      screen.getByRole("slider", { name: "Среднее качество удара" }),
      { target: { value: "15" } },
    );
    await user.click(
      screen.getByRole("button", { name: "Сравнить с текущим" }),
    );
    await waitFor(() =>
      expect(
        latest<Simulation>("/api/simulation")?.scenarios.find(
          (s) => s.id === "saved",
        )?.assumptions.shot_quality_change,
      ).toBe(0.25),
    );
    await user.click(screen.getByRole("button", { name: "Открыть" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("slider", {
            name: "Среднее качество удара",
          }) as HTMLInputElement
        ).value,
      ).toBe("25"),
    );
    await user.click(screen.getByRole("button", { name: "Удалить" }));
    expect(
      JSON.parse(localStorage.getItem("football-ai:scenarios:v1")!),
    ).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Тренерская сводка" }));
    const preview = await screen.findByRole("article", {
      name: "Предпросмотр тренерской сводки",
    });
    expect(preview.textContent).toContain("Райо Вальекано");
    expect(preview.textContent).toContain("23 апр. 2016");
    expect(preview.textContent).toContain("StatsBomb");
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await user.click(
      screen.getByRole("button", { name: "Печать / Сохранить в PDF" }),
    );
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
    await user.click(screen.getByRole("button", { name: "Закрыть окно" }));
    await user.click(
      await screen.findByRole("button", { name: "Перейти к рекомендации" }),
    );
    await user.click(await screen.findByText("Обсудить план с AI-аналитиком"));
    await screen.findByText(/Внешний AI не подключён/);
    expect(
      (
        screen.getByRole("button", {
          name: "Проанализировать с AI",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Открыть меню" }));
    expect(
      document.querySelector(".sidebar")?.classList.contains("is-open"),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Закрыть навигацию" }));
    expect(
      document.querySelector(".sidebar")?.classList.contains("is-open"),
    ).toBe(false);
    const before = JSON.parse(localStorage.getItem("football-ai:selection")!);
    const source = (await nativeFetch("http://127.0.0.1:8000/api/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team_id: before.selectedClubId,
        opponent_id: before.selectedOpponentId,
        is_home: before.isHome,
        priority: before.priority,
        max_interventions: before.maxInterventions,
        priority_strength: before.priorityStrength,
        scenario: before.currentTacticalScenario,
        as_of: before.selectedHistoricalMatchContext?.date ?? null,
      }),
    }).then((r) => r.json())) as Advisor;
    expect(
      Number(
        document
          .querySelector(".recommendation-card")
          ?.getAttribute("data-evidence-match"),
      ),
    ).toBe(source.recommendations[0].supporting_match_id);
    await user.click(
      screen.getAllByRole("button", {
        name: "Показать матч-доказательство",
      })[0],
    );
    await screen.findByRole("heading", { name: "География моментов" });
    const selection = JSON.parse(
      localStorage.getItem("football-ai:selection")!,
    );
    expect(selection.selectedMatchId).toBe(
      source.recommendations[0].supporting_match_id,
    );
  });
  it("проверяет ответ AI и уточняющий контекст с mock только в тесте", async () => {
    const user = userEvent.setup(),
      normalFetch = globalThis.fetch;
    const brief = (await nativeFetch(
      "http://127.0.0.1:8000/api/coaching/brief",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_id: 360, opponent_id: 220, is_home: true }),
      },
    ).then((r) => r.json())) as CoachingBrief;
    const comparison = await nativeFetch("http://127.0.0.1:8000/api/simulation", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({team_id:360,opponent_id:220,is_home:true,
        scenarios:[{id:"quality",title:"Качество ударов",shot_quality_change:-.1}]}),
    }).then(r=>r.json()) as Simulation;
    const calls: Record<string, unknown>[] = [];
    const output: AIAnalysis = {
      analysis_id: "11111111-1111-4111-8111-111111111111",
      team_id: 360,
      opponent_id: 220,
      model: "Тестовый провайдер",
      cached: false,
      analysis: {
        main_conclusion:
          "Проверьте организацию защиты центра. Это непроверенная гипотеза для штаба.",
        recommendation: "Проверить согласованную страховку центральной зоны.",
        unverified: true,
        why: [
          {
            text: "Допущенная опасность требует внимания.",
            evidence_ids: [brief.evidence[0].id],
          },
        ],
        alternatives: [],
        risks: ["Возможно открытие флангов."],
        evaluation_plan: ["Сравнить опасные допущенные удары."],
        missing_evidence: ["Нужен ручной видеоразбор."],
      },
      evidence: brief.evidence,
      scenario: comparison.scenarios[0],
      baseline: comparison.baseline,
      scope_note:
        "Только тестовый ответ; числовые параметры из реального backend.",
    };
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === "/api/advisor/ai/status")
          return new Response(
            JSON.stringify({
              available: true,
              model: output.model,
              message: "Тестовый провайдер",
            }),
            { status: 200 },
          );
        if (String(input) === "/api/advisor/ai") {
          calls.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify(output), { status: 200 });
        }
        return normalFetch(input, init);
      },
    );
    try {
      window.history.replaceState(
        {},
        "",
        "/plan?club=360&opponent=220#recommendation",
      );
      render(
        <BrowserRouter>
          <AppProvider>
            <App />
          </AppProvider>
        </BrowserRouter>,
      );
      fireEvent.change(await screen.findByRole("slider",{name:"Среднее качество удара"}),{target:{value:"-10"}});
      await user.click(
        await screen.findByText("Обсудить план с AI-аналитиком"),
      );
      await screen.findByRole("heading", { name: "Обсудить решение с AI" });
      await user.click(
        await screen.findByRole("button", { name: "Проверить настройку" }),
      );
      await waitFor(() =>
        expect(
          (
            screen.getByRole("button", {
              name: "Проанализировать с AI",
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(false),
      );
      await user.click(
        screen.getByRole("button", { name: "Проанализировать с AI" }),
      );
      await screen.findByRole("region", { name: "Ответ внешнего AI" });
      const scenarioResult=screen.getByRole("region",{name:"Результат выбранного сценария"});
      expect(within(scenarioResult).getByRole("heading",{name:"Выбранный сценарий: Качество ударов"})).toBeTruthy();
      expect(scenarioResult.textContent).toContain(signed(comparison.scenarios[0].delta_expected_points,3));
      expect(screen.getByText("Проверить согласованную страховку центральной зоны.")).toBeTruthy();
      expect(scenarioResult.textContent).not.toContain("страховку центральной зоны");
      expect(document.body.textContent).not.toMatch(/Числа и модельный эффект рассчитаны Python|Интерпретация AI требует проверки/);
      await user.type(
        screen.getByRole("textbox", { name: "Вопрос AI-советнику" }),
        "Какие риски у этого эксперимента?",
      );
      await user.click(
        screen.getByRole("button", { name: "Задать уточняющий вопрос" }),
      );
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1].previous_analysis_id).toBe(output.analysis_id);
      fireEvent.change(screen.getByRole("slider",{name:"Среднее качество удара"}),{target:{value:"20"}});
      await waitFor(()=>expect(screen.queryByRole("region",{name:"Ответ внешнего AI"})).toBeNull());
      expect(calls).toHaveLength(2); // Изменение допущений не запускает внешний AI.
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Выберите клуб" }),
        "217",
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("region", { name: "Ответ внешнего AI" }),
        ).toBeNull(),
      );
    } finally {
      vi.stubGlobal("fetch", normalFetch);
    }
  });

  it("выбирает альтернативу для сводки и сбрасывает план при смене клуба", async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      {},
      "",
      "/plan?club=360&opponent=220#recommendation",
    );
    render(
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>,
    );
    await waitFor(() =>
      expect(
        document
          .querySelector(".recommendations")
          ?.getAttribute("data-team-id"),
      ).toBe("360"),
    );
    await user.click(screen.getByText("Ещё два направления для сравнения"));
    const alternative = document.querySelectorAll(
      ".recommendation-card",
    )[1] as HTMLElement;
    const title = alternative.querySelector("h2")!.textContent!;
    await user.click(
      within(alternative).getByRole("button", { name: "Выбрать для сводки" }),
    );
    expect(document.querySelector(".chosen-plan")?.textContent).toContain(
      title,
    );
    await user.click(screen.getByRole("button", { name: "Тренерская сводка" }));
    const brief = await screen.findByRole("article", {
      name: "Предпросмотр тренерской сводки",
    });
    expect(brief.textContent).toContain(title);
    expect(brief.textContent).not.toMatch(/team:\d+|:before:|:season:/);
    const actualBrief=latest<CoachingBrief>("/api/coaching/brief")!;
    for(const e of actualBrief.evidence.slice(0,3))
      expect(brief.textContent).toContain(metricValue(e.metric,e.value));
    expect(brief.textContent).toContain("Ориентир сравнения");
    await user.click(screen.getByRole("button", { name: "Закрыть окно" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Выберите клуб" }),
      "217",
    );
    await waitFor(() =>
      expect(
        document
          .querySelector(".recommendations")
          ?.getAttribute("data-team-id"),
      ).toBe("217"),
    );
    expect(document.querySelector(".chosen-plan")).toBeNull();
    expect(
      JSON.parse(localStorage.getItem("football-ai:selection")!)
        .selectedMatchId,
    ).toBeNull();
    await navigate(user, "Подготовка к сопернику");
    await screen.findByRole("heading", {
      name: "Что учитывать против этого соперника",
    });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Выберите соперника" }),
      "212",
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("combobox", {
            name: "Выберите соперника",
          }) as HTMLSelectElement
        ).value,
      ).toBe("212"),
    );
    await waitFor(() =>
      expect(document.querySelector(".opponent-hero h2")?.textContent).toBe(
        "Атлетико Мадрид",
      ),
    );
  });

  it("отклоняет повреждённые сохранённые параметры", () => {
    expect(validSaved(null)).toBe(false);
    expect(validSaved({ clubId: 360, opponentId: 360 })).toBe(false);
    expect(
      validSaved({
        storageId: "x",
        name: "test",
        savedAt: new Date().toISOString(),
        clubId: 360,
        opponentId: 220,
        isHome: true,
        matchId: null,
        historicalContext: null,
        priority: "balanced",
        maxInterventions: 2,
        priorityStrength: 0.15,
        scenario: {
          id: "custom",
          title: "test",
          shot_volume_change: 0.1,
          shot_quality_change: 0,
          attack_xg_change: 0.1,
          xga_reduction: 0,
        },
      }),
    ).toBe(false);
  });

  it("показывает Эйбар без ложного преимущества и форматирует доли", async () => {
    const user=userEvent.setup();launch();
    await screen.findByRole("heading",{name:"Панель тренера"});
    await navigate(user,"Подготовка к сопернику");
    const clubs=await (await nativeFetch("http://127.0.0.1:8000/api/clubs")).json() as Club[];
    const eibar=clubs.find(c=>c.name==="Eibar")!;
    await user.selectOptions(await screen.findByRole("combobox",{name:"Выберите соперника"}),String(eibar.team_id));
    await waitFor(()=>expect(document.querySelector(".opponent-hero h2")?.textContent).toBe("Эйбар"));
    await user.click(screen.getByText("Примерно равные и неустойчивые показатели"));
    expect(document.querySelector(".opponent-summary")?.textContent).toContain("Показатель находится примерно на уровне лиги.");
    expect(metricValue("pass_accuracy",.666)).toBe("66,6%");
    expect(metricValue("pass_accuracy",.749)).toBe("74,9%");
    expect(metricValue("shot_quality",.102)).toBe("0,102");
  });

  it("сохраняет расчёт при +42%, завершает ошибку и повторяет; проверяет пределы ползунка", async () => {
    const user=userEvent.setup();launch();
    await screen.findByRole("heading",{name:"Панель тренера"});
    await navigate(user,"Тактический план");
    await screen.findByRole("heading",{name:"Что меняется в модели"});
    await user.click(screen.getByRole("button",{name:"Создание моментов"}));
    const slider=screen.getByRole("slider",{name:"Объём ударов"});
    const normalFetch=globalThis.fetch;
    let release!: (r:Response)=>void;
    let held=false;
    vi.stubGlobal("fetch",async(input:string|URL|Request,init?:RequestInit)=>{
      if(String(input)==="/api/simulation" && !held && JSON.parse(String(init?.body)).scenarios.find((s:{id:string})=>s.id==="creation")?.shot_volume_change===.42){
        held=true;return new Promise<Response>((resolve,reject)=>{
          release=resolve;
          init?.signal?.addEventListener("abort",()=>reject(new DOMException("cancelled","AbortError")),{once:true});
        });
      }
      return normalFetch(input,init);
    });
    try{
      fireEvent.change(slider,{target:{value:"42"}});
      await waitFor(()=>expect(held).toBe(true));
      expect(document.querySelector(".scenario-output .loading-grid")).toBeNull();
      expect(screen.getByRole("heading",{name:"Что меняется в модели"})).toBeTruthy();
      expect(document.querySelector(".scenario-output")?.getAttribute("aria-busy")).toBe("true");
      await act(async()=>release(new Response(JSON.stringify({detail:"Тестовая ошибка расчёта"}),{status:502})));
      const alert=await screen.findByRole("alert");
      expect(alert.textContent).toContain("Тестовая ошибка расчёта");
      expect(document.querySelector(".scenario-output")?.getAttribute("aria-busy")).toBe("false");
      expect(document.querySelector(".scenario-output .skeleton")).toBeNull();
      await user.click(within(alert).getByRole("button",{name:"Повторить"}));
      for(const value of [42,-50,50]){
        if(value!==42) fireEvent.change(slider,{target:{value:String(value)}});
        await waitFor(()=>expect(latest<Simulation>("/api/simulation")?.scenarios.find(s=>s.id==="creation")?.assumptions.shot_volume_change).toBe(value/100));
        await waitFor(()=>expect(document.querySelector(".scenario-output")?.getAttribute("aria-busy")).toBe("false"));
        const result=latest<Simulation>("/api/simulation")!;
        const scenario=result.scenarios.find(s=>s.id==="creation")!;
        expect(scenario.attack_xg).toBeCloseTo(result.baseline.attack_xg*(1+value/100),10);
        expect(scenario.probabilities.win+scenario.probabilities.draw+scenario.probabilities.loss).toBeCloseTo(1,10);
        expect(scenario.probabilities.expected_points).toBeCloseTo(3*scenario.probabilities.win+scenario.probabilities.draw,10);
        expect(screen.getByTestId("scenario-gain").textContent).toBe(signed(scenario.delta_expected_points,3));
        const track=document.querySelector(".scenario-output .probability-track")!;
        expect(track.getAttribute("aria-label")).toContain(`Победа: ${pct(scenario.probabilities.win)}`);
        expect(parseFloat((track.querySelector(".prob-win") as HTMLElement).style.width)).toBeCloseTo(scenario.probabilities.win*100,7);
      }
      expect(document.querySelectorAll(".note-warning")).toHaveLength(0);
      expect(screen.queryByRole("button",{name:"О допущениях сценария"})).toBeNull();
      await user.click(screen.getByRole("button",{name:"Методология и данные"}));
      expect(await screen.findByText("Допущения тактического плана")).toBeTruthy();
      await user.click(screen.getByText("Допущения тактического плана"));
      expect(screen.getByText(/Ползунки задают предположения/)).toBeTruthy();
    }finally{vi.stubGlobal("fetch",normalFetch);}
  });

  it("показывает точную ошибку AI компактно и повторяет только по кнопке",async()=>{
    const user=userEvent.setup(),normalFetch=globalThis.fetch;
    let calls=0;
    const detail="Ошибка HTTP-клиента до получения ответа OpenAI. Код: transport.client_error.";
    vi.stubGlobal("fetch",async(input:string|URL|Request,init?:RequestInit)=>{
      if(String(input)==="/api/advisor/ai/status") return new Response(JSON.stringify({available:true,model:"gpt-4.1-mini",message:"Ключ настроен; доступ проверяется по запросу.",source_is_current:true,integration_version:"test"}));
      if(String(input)==="/api/advisor/ai"){calls++;return new Response(JSON.stringify({detail}),{status:502});}
      return normalFetch(input,init);
    });
    try{
      launch();await screen.findByRole("heading",{name:"Панель тренера"});
      await navigate(user,"Тактический план");
      await user.click(screen.getByText("3. Получить рекомендацию и выбрать эксперимент"));
      await user.click(await screen.findByText("Обсудить план с AI-аналитиком"));
      await user.click(await screen.findByRole("button",{name:"Проверить настройку"}));
      const button=await screen.findByRole("button",{name:"Проанализировать с AI"});
      await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));
      await user.click(button);
      const alert=await screen.findByRole("alert");
      expect(alert.textContent).toContain(detail);expect(alert.classList.contains("error-inline")).toBe(true);
      expect(calls).toBe(1);
      expect(screen.queryByRole("region",{name:"Ответ внешнего AI"})).toBeNull();
      await user.click(within(alert).getByRole("button",{name:"Повторить"}));
      await waitFor(()=>expect(calls).toBe(2));
    }finally{vi.stubGlobal("fetch",normalFetch);}
  });
});
