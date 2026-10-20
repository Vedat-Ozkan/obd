import { Directory, File, FileMode, Paths, UploadTask, UploadType } from "expo-file-system";
import { latin1Decode } from "obd-core/recording";
import type { BetaFiles } from "./outbox.js";

const READ_CHUNK_BYTES = 1 << 20;
const outboxDir = () => new Directory(Paths.document, "beta-outbox");
const partFile = (fileId: string, index: number) => new File(outboxDir(), fileId, `part-${String(index).padStart(3, "0")}.jsonl`);
const created = new Set<string>();

async function* linesOf(file: File): AsyncIterable<string> {
  const handle = file.open(FileMode.ReadOnly);
  try {
    let rest = "";
    for (let chunk = handle.readBytes(READ_CHUNK_BYTES); chunk.length > 0; chunk = handle.readBytes(READ_CHUNK_BYTES)) {
      const lines = (rest + latin1Decode(chunk)).split("\n");
      rest = lines.pop() ?? "";
      yield* lines;
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
    if (rest !== "") yield rest;
  } finally { handle.close(); }
}

export const readLines = (path: string): AsyncIterable<string> => linesOf(new File(Paths.document, path));

export const betaPhoneFiles: BetaFiles = {
  async readState() {
    const file = new File(Paths.document, "beta.json");
    return file.exists ? file.text() : undefined;
  },
  async writeState(text) {
    const pending = new File(Paths.document, "beta.pending.json");
    if (pending.exists) pending.delete();
    pending.create();
    pending.write(text);
    await pending.move(new File(Paths.document, "beta.json"), { overwrite: true });
  },
  appendPart(fileId, index, text) {
    if (!created.has(fileId)) {
      new Directory(outboxDir(), fileId).create({ intermediates: true, idempotent: true });
      created.add(fileId);
    }
    partFile(fileId, index).write(text, { append: true });
  },
  readPartLines: (fileId, index) => linesOf(partFile(fileId, index)),
  partPath: (fileId, index) => partFile(fileId, index).uri,
  removeFile(fileId) {
    created.delete(fileId);
    const dir = new Directory(outboxDir(), fileId);
    if (dir.exists) dir.delete();
    return Promise.resolve();
  },
  fileIds() {
    const dir = outboxDir();
    return Promise.resolve(dir.exists ? dir.list().filter((entry) => entry instanceof Directory).map((entry) => entry.name) : []);
  },
};

export async function putFile(url: string, path: string, headers: Record<string, string>): Promise<{ status: number }> {
  const task = new UploadTask(new File(path), url, { httpMethod: "PUT", uploadType: UploadType.BINARY_CONTENT, headers });
  const { status } = await task.uploadAsync();
  return { status };
}
