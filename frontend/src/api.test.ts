import { afterEach, expect, it, vi } from "vitest";
import { apiRequest } from "./api";
import { useApi } from "./api";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("передаёт безопасную диагностику 502 советника без нового запроса", async () => {
  const detail = "Ответ AI отклонён: в текстовом поле есть числа. Поле: evaluation_plan[0]. Код: text.unsupported_numeric_claim. Расчётные рекомендации доступны.";
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 502 }));
  vi.stubGlobal("fetch", fetch);
  await expect(apiRequest("/api/advisor/ai", { team_id: 360, opponent_id: 220 }))
    .rejects.toThrow(detail);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("заканчивает ожидание ошибкой по тайм-ауту", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", (_path: string, init: RequestInit) => new Promise((_resolve,reject) => {
    init.signal!.addEventListener("abort",()=>reject(new DOMException("cancelled","AbortError")),{once:true});
  }));
  const promise=apiRequest("/api/simulation",{}, {timeoutMs:25});
  const assertion=expect(promise).rejects.toThrow("Сервер не ответил вовремя");
  await vi.advanceTimersByTimeAsync(30);await assertion;
});

it("отменяет устаревшие запросы, сохраняет предыдущий расчёт и игнорирует поздний ответ", async () => {
  const requests: { signal: AbortSignal; resolve: (value: Response)=>void; reject: (e: Error)=>void }[]=[];
  vi.stubGlobal("fetch", (_path: string, init: RequestInit) => new Promise<Response>((resolve,reject)=>{
    requests.push({signal:init.signal!,resolve,reject});
  }));
  const hook=renderHook(({value,team})=>useApi<{value:number}>("/test/scenario-race",{value,team},true,{retainKey:team}),{initialProps:{value:1,team:"A"}});
  await act(async()=>requests[0].resolve(new Response('{"value":1}')));
  await waitFor(()=>expect(hook.result.current.data?.value).toBe(1));
  hook.rerender({value:2,team:"A"});
  expect(hook.result.current.previousData?.value).toBe(1);
  expect(hook.result.current.loading).toBe(true);
  hook.rerender({value:3,team:"A"});
  await waitFor(()=>expect(requests[1].signal.aborted).toBe(true));
  await act(async()=>requests[2].resolve(new Response('{"value":3}')));
  await act(async()=>requests[1].resolve(new Response('{"value":2}')));
  expect(hook.result.current.data?.value).toBe(3);
  hook.rerender({value:4,team:"A"});
  await act(async()=>requests[3].reject(new Error("Расчёт отклонён сервером")));
  expect(hook.result.current.error).toBe("Расчёт отклонён сервером");
  expect(hook.result.current.loading).toBe(false);
  expect(hook.result.current.previousData?.value).toBe(3);
  hook.rerender({value:1,team:"B"});
  expect(hook.result.current.previousData).toBeUndefined();
  await act(async()=>requests[4].resolve(new Response('{"value":10}')));
});

it("не отменяет общий запрос, пока у него есть другой подписчик", async () => {
  let signal: AbortSignal, resolve!: (r: Response)=>void;
  const fetch=vi.fn((_p:string,init:RequestInit)=>{ signal=init.signal!;return new Promise<Response>(r=>resolve=r); });
  vi.stubGlobal("fetch",fetch);
  const first=renderHook(()=>useApi<{ok:boolean}>("/test/shared-read"));
  const second=renderHook(()=>useApi<{ok:boolean}>("/test/shared-read"));
  first.unmount();await Promise.resolve();
  expect(signal!.aborted).toBe(false);expect(fetch).toHaveBeenCalledTimes(1);
  await act(async()=>resolve(new Response('{"ok":true}')));
  expect(second.result.current.data?.ok).toBe(true);
});
