export interface ChargeRun<C> { readonly connection: C; readonly kind: "charge" | "drive"; stop: boolean; status: string }
export type ChargeRunListener = (status: string, running: boolean) => void;

export function createChargeRunRecord<C>() {
  let run: ChargeRun<C> | undefined;
  let finalLine: string | undefined;
  const listeners = new Set<ChargeRunListener>();
  const notify = (line: string) => { for (const listener of listeners) listener(line, run !== undefined); };
  const status = (line: string) => {
    if (!run) return;
    run.status = line; notify(line);
  };
  return {
    current: () => run,
    begin(connection: C, line: string, kind: "charge" | "drive" = "charge"): ChargeRun<C> {
      if (run) throw new Error("A charge log is already running.");
      run = { connection, kind, stop: false, status: line }; notify(line);
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
    mount(listener: ChargeRunListener): () => void {
      listeners.add(listener);
      if (run) listener(run.status, true);
      else if (finalLine !== undefined) listener(finalLine, false);
      return () => { listeners.delete(listener); };
    },
  };
}
