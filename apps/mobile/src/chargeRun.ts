// docs/specs/T2.4-charge-logger.md Decision 20: the running charge log lives here, not in a console's state.
// Android can recreate the activity mid-run while JS keeps running, and ble-plx hands every console the same BleManager.
export interface ChargeRun<C, M> { readonly connection: C; readonly manager: M; stop: boolean; status: string }
export type ChargeRunListener = (status: string, running: boolean) => void;

export function createChargeRunRecord<C, M extends { destroy(): unknown }>() {
  let run: ChargeRun<C, M> | undefined;
  // Decision 21: the final line outlives the run, so a console mounted after the end still shows why it stopped.
  let finalLine: string | undefined;
  let mounted = 0;
  const listeners = new Set<ChargeRunListener>();
  const notify = (line: string) => { for (const listener of listeners) listener(line, run !== undefined); };
  const status = (line: string) => {
    if (!run) return;
    run.status = line; notify(line);
  };
  return {
    current: () => run,
    begin(connection: C, manager: M, line: string): ChargeRun<C, M> {
      if (run) throw new Error("A charge log is already running.");
      run = { connection, manager, stop: false, status: line }; notify(line);
      return run;
    },
    status,
    requestStop(line: string) {
      if (!run) return;
      run.stop = true; status(line);
    },
    // A console mounted now shares the manager, so only the last one to unmount may destroy it.
    end(line: string) {
      const ended = run; run = undefined; finalLine = line; notify(line);
      if (ended && mounted === 0) void ended.manager.destroy();
    },
    // Called on mount; the returned cleanup says whether the console may close its link and destroy the manager.
    mount(listener: ChargeRunListener): () => boolean {
      mounted++; listeners.add(listener);
      if (run) listener(run.status, true);
      else if (finalLine !== undefined) listener(finalLine, false);
      return () => { mounted--; listeners.delete(listener); return run === undefined; };
    },
  };
}
