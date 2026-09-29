import type { Transport } from "obd-core/transport";
import type { TextStore } from "../garage/flow.js";

// docs/specs/X-2026-09-28-persistent-dongle.md: the BLE link is kept for the app session; runs get a view of it, not the link.
export interface LinkConnection { transport: Transport; deviceId: string; deviceName?: string }

type LinkListener<C> = (connection: C | undefined, lost?: { error: Error | null }) => void;

export function createDongleLink<C extends LinkConnection>(deps: {
  connect(deviceId: string): Promise<C>;
  onDisconnected(deviceId: string, listener: (error: Error | null) => void): { remove(): void };
}) {
  let connection: C | undefined;
  let subscription: { remove(): void } | undefined;
  let lastId: string | undefined;
  let held = false;
  let pending: { id: string; promise: Promise<C> } | undefined;
  const listeners = new Set<LinkListener<C>>();
  const notify = (lost?: { error: Error | null }) => { for (const listener of listeners) listener(connection, lost); };

  // Detaches the link first, so a second caller or a late disconnect event never sees a half-closed one.
  const detach = (): Promise<void> => {
    const old = connection; if (!old) return Promise.resolve();
    connection = undefined; subscription?.remove(); subscription = undefined;
    return old.transport.close().catch(() => undefined);
  };
  const open = async (id: string, force: boolean): Promise<C> => {
    if (!force && connection?.deviceId === id) return connection;
    await detach();
    const next = await deps.connect(id);
    connection = next; lastId = id;
    subscription = deps.onDisconnected(id, (error) => {
      // A disconnect event from a connection this store already replaced or dropped is not this link's loss.
      if (connection !== next) return;
      void detach(); notify({ error });
    });
    notify();
    return next;
  };
  // One connect at a time: the next waits for the one before it, whether that succeeded or not.
  const start = (id: string, force: boolean): Promise<C> => {
    const previous = pending?.promise.catch(() => undefined) ?? Promise.resolve();
    const promise: Promise<C> = previous.then(() => open(id, force)).finally(() => { if (pending?.promise === promise) pending = undefined; });
    pending = { id, promise };
    return promise;
  };

  return {
    current: () => connection,
    connecting: () => pending !== undefined,
    connect(deviceId: string): Promise<C> {
      held = false;
      if (pending?.id === deviceId) return pending.promise;
      return start(deviceId, false);
    },
    reconnect(): Promise<C> {
      if (lastId === undefined) return Promise.reject(new Error("no dongle to reconnect to"));
      return start(lastId, true);
    },
    async drop() { await detach(); notify(); },
    async disconnect() { held = true; await detach(); notify(); },
    held: () => held,
    subscribe(listener: LinkListener<C>) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** A per-run view of the kept link: close() makes later writes reject and removes this view's listeners; the link stays open. */
export function runView(transport: Transport): Transport {
  let closed = false;
  const unsubscribers = new Set<() => void>();
  return {
    startsIdle: transport.startsIdle,
    write(bytes) { return closed ? Promise.reject(new Error("dongle link view is closed")) : transport.write(bytes); },
    onData(callback) {
      if (closed) return () => undefined;
      const off = transport.onData((bytes) => { if (!closed) callback(bytes); });
      unsubscribers.add(off);
      return () => { off(); unsubscribers.delete(off); };
    },
    close() {
      closed = true;
      for (const off of unsubscribers) off();
      unsubscribers.clear();
      return Promise.resolve();
    },
  };
}

export type RememberedDongle = { id: string; name?: string };
type DongleFile = { version: 1; cars: Record<string, RememberedDongle | undefined> };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// Not garage.json: a bad dongle file must only mean "nothing remembered", and the Bluetooth address must stay out of beta uploads.
function parseFile(raw: string | undefined): DongleFile {
  const empty: DongleFile = { version: 1, cars: {} };
  if (raw === undefined) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.cars)) return empty;
    const cars: DongleFile["cars"] = {};
    for (const [garageId, value] of Object.entries(parsed.cars)) {
      if (!isRecord(value) || typeof value.id !== "string" || value.id === "") continue;
      cars[garageId] = { id: value.id, ...(typeof value.name === "string" ? { name: value.name } : {}) };
    }
    return { version: 1, cars };
  } catch { return empty; }
}

export function createDongleMemory(store: TextStore) {
  // Reads and writes run one after another, so two quick remember() calls cannot overwrite each other.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  };
  const load = async () => parseFile(await store.read().catch(() => undefined));
  return {
    get: (garageId: string): Promise<RememberedDongle | undefined> => serial(async () => (await load()).cars[garageId]),
    remember: (garageId: string, dongle: RememberedDongle): Promise<void> => serial(async () => {
      const file = await load();
      const stored = file.cars[garageId];
      const name = dongle.name ?? (stored?.id === dongle.id ? stored.name : undefined);
      file.cars[garageId] = { id: dongle.id, ...(name === undefined ? {} : { name }) };
      await store.write(JSON.stringify(file));
    }),
  };
}
