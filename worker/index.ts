// STUB: owned by backend-engineer. Serves /api/* and falls through to static assets.
export interface Env {
  ASSETS: Fetcher;
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  LEAD_EMAIL_TO?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ ok: false, error: "server", message: "Not implemented yet" }, { status: 501 });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
