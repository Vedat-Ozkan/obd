// docs/specs/T2.4-charge-logger.md Decision 20: the running charge log lives here, not in a console's state.
// Android can recreate the activity mid-run while JS keeps running, so a console recreated with it still sees and stops the run.
// docs/specs/X-2026-09-28-persistent-dongle.md supersedes the manager part of Decision 20: the BLE manager and link now live for
// the whole app session (runtime.ts), so this record owns and destroys neither.
export interface ChargeRun<C> { readonly connection: C; stop: boolean; status: string }
export type ChargeRunListener = (status: string, running: boolean) => void;

export function createChargeRunRecord<C>() {
  let run: ChargeRun<C> | undefined;
  // Decision 21: the final line outlives the run, so a console mounted after the end still shows why it stopped.
  let finalLine: string | undefined;
  const listeners = new Set<ChargeRunListener>();
  const notify = (line: string) => { for (const listener of listeners) listener(line, run !== undefined); };
  const status = (line: string) => {
    if (!run) return;
    run.status = line; notify(line);
  };
  return {
    current: () => run,
    begin(connection: C, line: string): ChargeRun<C> {
      if (run) throw new Error("A charge log is already running.");
      run = { connection, stop: false, status: line }; notify(line);
      return run;
    },
    status,
    requestStop(line: string) {
      if (!run) return;
      run.stop = true; status(line);
    },
    end(line: string) {
      run = undefined; finalLine = line; notify(line);
    },
    // Called on mount; the returned cleanup only stops listening.
    mount(listener: ChargeRunListener): () => void {
      listeners.add(listener);
      if (run) listener(run.status, true);
      else if (finalLine !== undefined) listener(finalLine, false);
      return () => { listeners.delete(listener); };
    },
  };
}
