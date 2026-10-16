import { handleApi, type AnalyzeEnv } from "./analyze";

interface Env extends AnalyzeEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) {
      return handleApi(request, env, (input, init) => fetch(input, init));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
