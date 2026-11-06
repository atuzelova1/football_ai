import { useEffect, useRef, useState } from "react";

type Entry = { expires: number; promise: Promise<unknown>; controller: AbortController; users: number; settled: boolean };
const cache = new Map<string, Entry>();
export async function apiRequest<T>(path: string, body?: unknown, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? (path === "/api/advisor/ai" ? 65000 : 30000));
  try {
    const response = await fetch(path, {
      ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Football-AI": "1" }, body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const data = await response.json().catch((e: Error) => { if (e.name === "AbortError") throw e; return null; });
    if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "Сервер отклонил запрос. Повторите попытку.");
    if (data === null) throw new Error("Сервер вернул неполный ответ. Повторите запрос.");
    return data as T;
  } catch (e) {
    if (timedOut) throw new Error(path === "/api/advisor/ai" ? "Истекло время ожидания AI. Запрос мог быть обработан; повтор возможен только вручную." : "Сервер не ответил вовремя. Повторите расчёт.");
    if (controller.signal.aborted) throw new DOMException("Запрос отменён", "AbortError");
    if (e instanceof TypeError) throw new Error("Нет связи с backend. Проверьте запуск сервера.");
    throw e;
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

export function useApi<T>(path: string, body?: unknown, enabled = true, options: { retainKey?: string } = {}) {
  const serialized = body === undefined ? "" : JSON.stringify(body);
  const key = path + serialized;
  const retainKey = options.retainKey;
  const retained = useRef<{ scope: string; data: T } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key: "" });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let entry = cache.get(key);
    if (!entry || entry.expires <= Date.now() || entry.controller.signal.aborted) {
      const controller = new AbortController();
      entry = { expires: Date.now() + 600_000, controller, users: 0, settled: false,
        promise: apiRequest<T>(path, serialized ? JSON.parse(serialized) : undefined, { signal: controller.signal }) };
      const current = entry;
      entry.promise.then(() => { current.settled = true; }, () => {
        current.settled = true;
        if (cache.get(key) === current) cache.delete(key);
      });
      cache.set(key, entry);
      if (cache.size > 250) {
        const old = [...cache].find(([, e]) => e.settled);
        if (old) cache.delete(old[0]);
      }
    }
    const current = entry;
    current.users++;
    current.promise.then((data) => {
      if (!live) return;
      if (retainKey) retained.current = { scope: retainKey, data: data as T };
      setState({ key, data: data as T });
    }).catch((e: Error) => {
      if (live && e.name !== "AbortError") setState({ key, error: e.message });
    });
    return () => {
      live = false;
      current.users--;
      if (!current.settled && current.users === 0) {
        queueMicrotask(() => {
          if (!current.settled && current.users === 0) {
            if (cache.get(key) === current) cache.delete(key);
            current.controller.abort();
          }
        });
      }
    };
  }, [key, attempt, enabled, path, serialized, retainKey]);
  return {
    data: enabled && state.key === key ? state.data : undefined,
    previousData: retainKey && retained.current?.scope === retainKey ? retained.current.data : undefined,
    error: enabled && state.key === key ? state.error : undefined,
    loading: enabled && (state.key !== key || (!state.data && !state.error)),
    retry: () => {
      cache.delete(key);
      setState({ key: "" });setAttempt((x) => x + 1);
    },
  };
}
