import { QueryClient } from "@tanstack/react-query";

export type ControlledPromise<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

/** Una promise risolvibile dal test, utile per far terminare B prima di A. */
export function controlledPromise<T>(): ControlledPromise<T> {
  let resolve!: ControlledPromise<T>["resolve"];
  let reject!: ControlledPromise<T>["reject"];
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** Una cache isolata per test, senza retry o garbage collection temporizzata. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}
