import { Elm327Session, ElmSessionError, type ElmResponse } from "../elm/session.js";
import type { Mode22Module, VehicleProfile } from "./profile.js";

export interface Mode22Outcome {
  target: string;
  did: string;
  response: ElmResponse;
}

function validatedModules(profile: VehicleProfile): Mode22Module[] {
  const modules = profile.mode22;
  if (modules === undefined || modules.length === 0) return [];
  if (profile.protocol !== "7") throw new Error("Mode 22 profile requires protocol 7");
  const targets = new Set<string>();
  return modules.map((module) => {
    if (!/^[0-9A-F]{2}$/.test(module.target) || targets.has(module.target)) throw new Error("invalid or duplicate Mode 22 target");
    targets.add(module.target);
    if (module.dids.length === 0) throw new Error("Mode 22 module requires a DID");
    const dids = new Set<string>();
    for (const did of module.dids) {
      if (!/^[0-9A-F]{4}$/.test(did) || dids.has(did)) throw new Error("invalid or duplicate Mode 22 DID");
      dids.add(did);
    }
    return { target: module.target, dids: [...dids] };
  });
}

/** Setup and read sequence from the two committed Equinox spike tails and docs/ELM327.md §Per-car notes. */
export async function scanMode22Profile(session: Elm327Session, profile: VehicleProfile): Promise<readonly Mode22Outcome[]> {
  const modules = validatedModules(profile);
  if (modules.length === 0) return [];

  async function setup(cmd: string): Promise<void> {
    const response = await session.send(cmd);
    if (response.kind !== "ok") throw new ElmSessionError("init", cmd, response);
  }

  await setup("ATSP7");
  await setup("ATCP 18");
  const outcomes: Mode22Outcome[] = [];
  for (const [index, module] of modules.entries()) {
    const target = module.target;
    await setup(`ATSH DA${target}F1`);
    await setup(`ATCRA 18DAF1${target}`);
    await setup(`ATFCSH 18DA${target}F1`);
    if (index === 0) {
      await setup("ATFCSD 300000");
      await setup("ATFCSM 1");
    }
    for (const did of module.dids) {
      outcomes.push({ target, did, response: await session.send(`22 ${did}`) });
    }
  }
  return outcomes;
}
