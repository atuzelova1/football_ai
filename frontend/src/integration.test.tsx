import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
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
import { clubName } from "./format";

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
  return requests.filter((r) => r.path.startsWith(path)).at(-1)?.response as
    | T
    | undefined;
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

describe("Полный пользовательский путь с реальным FastAPI (DOM, не браузер)", () => {
  it.each([
    "Barcelona",
    "Real Madrid",
    "Atlético Madrid",
    "Athletic Club",
    "Villarreal",
  ])("проверяет весь путь и все шесть разделов: %s", async (targetName) => {
    const user = userEvent.setup();
    launch();
    await screen.findByRole("heading", { name: "Игра за цифрами" });
    await screen.findByRole("heading", { name: "Атлетик Бильбао" });
    const clubs = requests.find((r) => r.path === "/api/clubs")!
      .response as Club[];
    expect(
      screen
        .getByRole("combobox", { name: "Выберите клуб" })
        .querySelectorAll("option"),
    ).toHaveLength(20);
    const oldClub = Number(
      (
        screen.getByRole("combobox", {
          name: "Выберите клуб",
        }) as HTMLSelectElement
      ).value,
    );
    const next = clubs.find((c) => c.name === targetName)!;
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Выберите клуб" }),
      String(next.team_id),
    );
    await waitFor(() =>
      expect(
        latest<{ team: { team_id: number } }>(
          `/api/clubs/${next.team_id}/overview`,
        )?.team.team_id,
      ).toBe(next.team_id),
    );
    await waitFor(() =>
      expect(document.querySelector(".club-hero h2")?.textContent).toBe(
        clubName(next.name),
      ),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Показатель по исходам" }),
      "pass_share",
    );
    expect(
      screen
        .getAllByText(/Доля передач — событийный прокси/)
        .some((el) => el.classList.contains("chart-note")),
    ).toBe(true);
    await navigate(user, "Анализ матчей");
    await screen.findByRole("heading", { name: "География моментов" });
    const match = latest<MatchAnalysis>("/api/matches/")!;
    const plotted = match.shots.filter((s) => s.x != null && s.y != null);
    expect(document.querySelectorAll(".shot-marker")).toHaveLength(
      plotted.length,
    );
    expect(document.querySelector(".football-pitch")).not.toBeNull();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Фильтр по результату" }),
      "L",
    );
    const selectedButton = document.querySelector<HTMLButtonElement>(
      ".match-list .match-card",
    )!;
    await user.click(selectedButton);
    await waitFor(() =>
      expect(document.querySelector(".score-main")?.textContent).toContain(
        "Поражение",
      ),
    );
    await navigate(user, "Анализ соперников");
    await screen.findByRole("heading", { name: "Карта игровых профилей" });
    await user.click(screen.getByText("Сравнить центры игровых групп"));
    await screen.findByRole("img", { name: "Группа 1, Группа 2" });
    const opponentSelect = screen.getByRole("combobox", {
      name: "Выберите соперника",
    }) as HTMLSelectElement;
    const newOpponent = Array.from(opponentSelect.options).find(
      (o) => o.value !== opponentSelect.value,
    )!.value;
    await user.selectOptions(opponentSelect, newOpponent);
    expect(
      JSON.parse(localStorage.getItem("football-ai:selection")!)
        .selectedMatchId,
    ).toBeNull();
    await waitFor(() =>
      expect(document.querySelector(".opponent-hero")?.textContent).toContain(
        opponentSelect.selectedOptions[0].textContent,
      ),
    );
    await navigate(user, "Анализ матчей");
    await waitFor(() =>
      expect(
        document
          .querySelector(".match-score-header")
          ?.getAttribute("data-opponent-id"),
      ).toBe(newOpponent),
    );
    await navigate(user, "ML-прогноз");
    await screen.findByRole("heading", { name: "Вероятности, а не обещания" });
    const context = (await screen.findByRole("combobox", {
      name: "Контекст прогноза",
    })) as HTMLSelectElement;
    expect(context.options.length).toBeGreaterThan(1);
    const historicalId = context.options[1].value;
    await user.selectOptions(context, historicalId);
    await waitFor(() =>
      expect(latest<Prediction>("/api/prediction")?.context.match_id).toBe(
        Number(historicalId),
      ),
    );
    await waitFor(() =>
      expect(
        document.querySelector(".prediction-result")?.textContent,
      ).toContain("Невиденный при обучении матч"),
    );
    cleanup();
    render(
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>,
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("combobox", {
            name: "Контекст прогноза",
          }) as HTMLSelectElement
        ).value,
      ).toBe(historicalId),
    );
    await user.click(
      screen.getByRole("button", { name: /Сравнить тактические сценарии/ }),
    );
    await screen.findByRole("heading", { name: "Что меняется в модели" });
    const gain = screen.getByTestId("scenario-gain").textContent;
    const slider = screen.getByRole("slider", {
      name: "Среднее качество удара",
    });
    fireEvent.change(slider, { target: { value: "25" } });
    await waitFor(() =>
      expect(
        latest<Simulation>("/api/simulation")?.scenarios.find(
          (s) => s.id === "quality",
        )?.assumptions.shot_quality_change,
      ).toBe(0.25),
    );
    await waitFor(() =>
      expect(screen.getByTestId("scenario-gain").textContent).not.toBe(gain),
    );
    expect(
      document.querySelectorAll(".scenario-compare-card").length,
    ).toBeGreaterThanOrEqual(3);
    await user.click(
      screen.getByRole("button", {
        name: /Использовать этот сценарий в AI-советнике/,
      }),
    );
    await screen.findByRole("heading", {
      name: "Основание для следующего шага",
    });
    await screen.findAllByText("Качество ударов: +25%");
    await waitFor(() =>
      expect(latest<Advisor>("/api/advisor")?.selected_scenario_id).toBe(
        "quality",
      ),
    );
    const advice = latest<Advisor>("/api/advisor")!;
    expect(advice.team.team_id).toBe(next.team_id);
    expect(
      advice.recommendations.find((r) => r.scenario_id === "quality")!
        .scenario_assumptions.shot_quality_change,
    ).toBe(0.25);
    const evidenceButton = screen.getAllByRole("button", {
      name: /Показать доказательства/,
    })[0];
    await user.click(evidenceButton);
    await screen.findByRole("heading", { name: "Выбранное доказательство" });
    await user.click(screen.getByRole("button", { name: /Открыть меню/ }));
    expect(
      document.querySelector(".sidebar")?.classList.contains("is-open"),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Закрыть навигацию" }));
    expect(
      document.querySelector(".sidebar")?.classList.contains("is-open"),
    ).toBe(false);
    await user.click(
      screen.getByRole("button", { name: /Показать матч-доказательство/ }),
    );
    await screen.findByRole("heading", { name: "География моментов" });
    const state = JSON.parse(localStorage.getItem("football-ai:selection")!);
    const sourceMatches = requests.find(
      (r) => r.path === `/api/clubs/${next.team_id}/matches`,
    )!.response as { match_id: number; opponent_id: number }[];
    const sourceMatch = sourceMatches.find(
      (m) => m.match_id === state.selectedMatchId,
    )!;
    expect(state.selectedOpponentId).toBe(sourceMatch.opponent_id);
    await waitFor(() =>
      expect(
        document
          .querySelector(".match-score-header")
          ?.getAttribute("data-opponent-id"),
      ).toBe(String(sourceMatch.opponent_id)),
    );
  });
  it("позволяет выбрать каждый из 20 клубов и сбрасывает несовместимый матч", async () => {
    const user = userEvent.setup();
    launch();
    await screen.findByRole("heading", { name: "Игра за цифрами" });
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
      expect(window.location.search).toContain(`club=${club.team_id}`);
      const stored = JSON.parse(localStorage.getItem("football-ai:selection")!);
      expect(stored.selectedHistoricalMatchContext).toBeNull();
      expect(stored.currentTacticalScenario).toBeNull();
      expect(stored.selectedMatchId).toBeNull();
    }
  });
  it("обновляет данные при смене клуба внутри каждого активного раздела", async () => {
    const user = userEvent.setup();
    launch();
    await screen.findByRole("heading", { name: "Игра за цифрами" });
    const clubs = requests.find((r) => r.path === "/api/clubs")!
      .response as Club[];
    const cases = [
      ["Обзор команды", "Barcelona", ".club-hero"],
      ["Анализ матчей", "Real Madrid", ".match-score-header"],
      ["Анализ соперников", "Atlético Madrid", ".opponent-hero"],
      ["ML-прогноз", "Athletic Club", ".prediction-top"],
      ["Симулятор", "Villarreal", ".baseline-vs"],
      ["AI-советник", "Barcelona", ".advisor-intro"],
    ];
    for (const [page, name, selector] of cases) {
      await navigate(user, page);
      const club = clubs.find((c) => c.name === name)!;
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Выберите клуб" }),
        String(club.team_id),
      );
      await waitFor(() =>
        expect(
          document.querySelector(selector)?.getAttribute("data-team-id"),
        ).toBe(String(club.team_id)),
      );
    }
  });
});
