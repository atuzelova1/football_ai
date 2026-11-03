import { useEffect, useState } from "react";

const cache = new Map<string, { expires: number; promise: Promise<unknown> }>();
function request<T>(path: string, body?: unknown): Promise<T> {
  return fetch(
    path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  )
    .then(async (r) => {
      const data = await r.json().catch(() => null);
      if (!r.ok)
        throw new Error(
          typeof data?.detail === "string"
            ? data.detail
            : "Не удалось получить данные. Проверьте подключение к backend.",
        );
      return data as T;
    })
    .catch((e) => {
      throw new Error(
        e instanceof TypeError
          ? "Нет связи с сервером. Запустите FastAPI и повторите запрос."
          : e.message,
      );
    });
}

export function useApi<T>(path: string, body?: unknown, enabled = true) {
  const serialized = body === undefined ? "" : JSON.stringify(body);
  const key = path + serialized;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>(
    { key: "" },
  );
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const entry = cache.get(key);
    let promise: Promise<T>;
    if (entry && entry.expires > Date.now())
      promise = entry.promise as Promise<T>;
    else {
      promise = request<T>(
        path,
        serialized ? JSON.parse(serialized) : undefined,
      );
      cache.set(key, { expires: Date.now() + 600_000, promise });
      if (cache.size > 250) cache.delete(cache.keys().next().value!);
      promise.catch(() => cache.delete(key));
    }
    promise
      .then((data) => {
        if (live) setState({ key, data });
      })
      .catch((e: Error) => {
        if (live) setState({ key, error: e.message });
      });
    return () => {
      live = false;
    };
  }, [key, attempt, enabled, path, serialized]);
  return {
    data: enabled && state.key === key ? state.data : undefined,
    error: enabled && state.key === key ? state.error : undefined,
    loading: enabled && (state.key !== key || (!state.data && !state.error)),
    retry: () => {
      cache.delete(key);
      setState({ key: "" });
      setAttempt((x) => x + 1);
    },
  };
}
