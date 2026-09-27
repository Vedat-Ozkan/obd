// Beta upload Worker entry module (ADR-019; docs/specs/T2.9-beta-data-upload.md §Stage C1). D5 (docs/task-runs/T2.9.md):
// only the default export lives here, because workerd treats every named export of the main module as an entrypoint.
import { handleRequest, type Env } from "./handler.js";

export default { fetch: (request: Request, env: Env) => handleRequest(request, env, new Date()) };
