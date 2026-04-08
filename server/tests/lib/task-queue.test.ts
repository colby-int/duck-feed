import { describe, expect, it } from 'vitest';
import { createTaskQueue } from '../../src/lib/task-queue.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('createTaskQueue', () => {
  it('runs queued tasks one at a time when concurrency is 1', async () => {
    const queue = createTaskQueue(1);
    const firstGate = deferred();
    const secondGate = deferred();
    const thirdGate = deferred();
    const started: string[] = [];
    const finished: string[] = [];

    const first = queue.enqueue(async () => {
      started.push('first');
      await firstGate.promise;
      finished.push('first');
      return 'first';
    });

    const second = queue.enqueue(async () => {
      started.push('second');
      await secondGate.promise;
      finished.push('second');
      return 'second';
    });

    const third = queue.enqueue(async () => {
      started.push('third');
      await thirdGate.promise;
      finished.push('third');
      return 'third';
    });

    await Promise.resolve();
    expect(started).toEqual(['first']);
    expect(queue.activeCount).toBe(1);
    expect(queue.pendingCount).toBe(2);

    firstGate.resolve();
    await first;
    await nextTick();
    expect(started).toEqual(['first', 'second']);
    expect(finished).toEqual(['first']);

    secondGate.resolve();
    await second;
    await nextTick();
    expect(started).toEqual(['first', 'second', 'third']);
    expect(finished).toEqual(['first', 'second']);

    thirdGate.resolve();
    await expect(third).resolves.toBe('third');
    expect(finished).toEqual(['first', 'second', 'third']);
    expect(queue.activeCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });

  it('starts up to the configured concurrency immediately', async () => {
    const queue = createTaskQueue(2);
    const firstGate = deferred();
    const secondGate = deferred();
    const thirdGate = deferred();
    const started: string[] = [];

    const first = queue.enqueue(async () => {
      started.push('first');
      await firstGate.promise;
    });
    const second = queue.enqueue(async () => {
      started.push('second');
      await secondGate.promise;
    });
    const third = queue.enqueue(async () => {
      started.push('third');
      await thirdGate.promise;
    });

    await Promise.resolve();
    expect(started).toEqual(['first', 'second']);
    expect(queue.activeCount).toBe(2);
    expect(queue.pendingCount).toBe(1);

    firstGate.resolve();
    await first;
    await nextTick();
    expect(started).toEqual(['first', 'second', 'third']);

    secondGate.resolve();
    thirdGate.resolve();
    await Promise.all([second, third]);
    expect(queue.activeCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });
});
