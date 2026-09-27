import type { BetaManifest } from "obd-core/recording/provenance";
import { BackendError, type Auth, type BetaBackend } from "./outbox.js";

// The phone's HTTPS client for the beta upload Worker (ADR-019): docs/specs/T2.9-beta-data-upload.md §Stage C1 HTTP
// contract and §client.ts, plus the orchestrator's C1-b DELETE /v1/files/<fileId>. A rejected request is
// BackendError("network"); an answer other than 2xx is BackendError(<status>). Messages never hold the secret.

export function createBetaClient(baseUrl: string, deps: {
  fetch: typeof fetch;
  /** Stage D: expo-file-system UploadTask (httpMethod "PUT", BINARY_CONTENT). Tests: read the fake file, call fetch. */
  putFile(url: string, path: string, headers: Record<string, string>): Promise<{ status: number }>;
}): BetaBackend {
  const url = (path: string) => `${baseUrl.replace(/\/+$/, "")}${path}`;
  const authorization = (auth: Auth) => ({ Authorization: `Bearer ${auth.installId}:${auth.secret}` });

  async function send(what: string, request: () => Promise<{ status: number }>): Promise<void> {
    let status: number;
    try {
      ({ status } = await request());
    } catch {
      throw new BackendError("network", `${what}: the beta server could not be reached`);
    }
    if (status < 200 || status > 299) throw new BackendError(status, `${what}: the beta server answered ${String(status)}`);
  }
  const call = (what: string, path: string, init: RequestInit) => send(what, () => deps.fetch(url(path), init));

  return {
    register: (auth, consentVersion) => call("register", "/v1/installs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installId: auth.installId, secret: auth.secret, consentVersion }),
    }),
    putPart: (auth, fileId, index, path) => send("part upload", () => deps.putFile(
      url(`/v1/files/${fileId}/parts/${String(index)}`), path, { ...authorization(auth), "Content-Type": "application/octet-stream" },
    )),
    putManifest: (auth, fileId, manifest: BetaManifest) => call("manifest upload", `/v1/files/${fileId}/manifest`, {
      method: "PUT",
      headers: { ...authorization(auth), "Content-Type": "application/json" },
      body: JSON.stringify(manifest),
    }),
    deleteAll: (auth) => call("delete", "/v1/installs/me", { method: "DELETE", headers: authorization(auth) }),
    deleteFile: (auth, fileId) => call("file delete", `/v1/files/${fileId}`, { method: "DELETE", headers: authorization(auth) }),
  };
}
