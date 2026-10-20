import { handleRequest, type Env } from "./handler.js";

export default { fetch: (request: Request, env: Env) => handleRequest(request, env, new Date()) };
