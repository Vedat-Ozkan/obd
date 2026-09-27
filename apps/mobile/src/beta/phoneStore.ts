import { Directory, File, FileMode, Paths, UploadTask, UploadType } from "expo-file-system";
import { latin1Decode } from "obd-core/recording";
import type { BetaFiles } from "./outbox.js";

// T2.9 Stage D (docs/specs/T2.9-beta-data-upload.md §Files Stage D): the outbox's app-private storage, the client's
// putFile, and a line reader for private recordings, over expo-file-system 57.0.7 (File.write append, File.open,
// UploadTask). A charge log is tens of MB, so nothing here reads a whole file into one string.

const READ_CHUNK_BYTES = 1 << 20;
const outboxDir = () => new Directory(Paths.document, "beta-outbox");
const partFile = (fileId: string, index: number) => new File(outboxDir(), fileId, `part-${String(index).padStart(3, "0")}.jsonl`);
/** fileIds whose directory this process has created, so appendPart creates it once (repair 1 (3)). */
const created = new Set<string>();

/** Recordings and parts are Python json.dumps form, which is ASCII, so bytes decode one to one. */
async function* linesOf(file: File): AsyncIterable<string> {
  const handle = file.open(FileMode.ReadOnly);
  try {
    let rest = "";
    for (let chunk = handle.readBytes(READ_CHUNK_BYTES); chunk.length > 0; chunk = handle.readBytes(READ_CHUNK_BYTES)) {
      const lines = (rest + latin1Decode(chunk)).split("\n");
      rest = lines.pop() ?? "";
      yield* lines;
      // A macrotask per chunk, so scrubbing a long charge log does not freeze the screen.
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
    if (rest !== "") yield rest;
  } finally { handle.close(); }
}

/** The lines of an app-private file, by its path under Documents (captures/…, battery-scans/…). */
export const readLines = (path: string): AsyncIterable<string> => linesOf(new File(Paths.document, path));

export const betaPhoneFiles: BetaFiles = {
  async readState() {
    const file = new File(Paths.document, "beta.json");
    return file.exists ? file.text() : undefined;
  },
  // The garage documentStore pattern: a pending copy moved over the old one.
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

/** createBetaClient's putFile: streams the part from disk; the transport sets Content-Length from the file size. */
export async function putFile(url: string, path: string, headers: Record<string, string>): Promise<{ status: number }> {
  const task = new UploadTask(new File(path), url, { httpMethod: "PUT", uploadType: UploadType.BINARY_CONTENT, headers });
  const { status } = await task.uploadAsync();
  return { status };
}
