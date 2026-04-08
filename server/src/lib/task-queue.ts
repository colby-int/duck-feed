export interface TaskQueue {
  readonly activeCount: number;
  readonly pendingCount: number;
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

export function createTaskQueue(concurrency: number): TaskQueue {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Task queue concurrency must be a positive integer, received: ${concurrency}`);
  }

  const pending: Array<() => void> = [];
  let activeCount = 0;

  const drain = (): void => {
    while (activeCount < concurrency && pending.length > 0) {
      const runNext = pending.shift();
      if (!runNext) {
        return;
      }

      runNext();
    }
  };

  return {
    get activeCount() {
      return activeCount;
    },
    get pendingCount() {
      return pending.length;
    },
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        pending.push(() => {
          activeCount += 1;
          void Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              activeCount -= 1;
              drain();
            });
        });
        drain();
      });
    },
  };
}
