// Worker entry: /api/* is handled here (run_worker_first); everything else is served from static assets.
import { handleApi } from "./handler";
import type { Env } from "./lib/env";

export type { Env } from "./lib/env";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
