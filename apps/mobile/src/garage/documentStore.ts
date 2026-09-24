import { File, Paths } from "expo-file-system";
import type { TextStore } from "./flow.js";

export const garageDocumentStore: TextStore = {
  async read() {
    const file = new File(Paths.document, "garage.json");
    return file.exists ? file.text() : undefined;
  },
  async write(text) {
    const pending = new File(Paths.document, "garage.pending.json");
    const destination = new File(Paths.document, "garage.json");
    if (pending.exists) pending.delete();
    pending.create();
    pending.write(text);
    await pending.move(destination, { overwrite: true });
  },
};
