/** A promise queue: tasks run one at a time, in order, even if an earlier one failed. */
export type Lock = <T>(task: () => Promise<T>) => Promise<T>;

export function createLock(): Lock {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };
}
