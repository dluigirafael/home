import { App, staticFiles } from "fresh";
import type { State } from "./server/config.ts";
import { statsCache } from "./server/state.ts";

export const app = new App<State>()
  .use((ctx) => {
    ctx.state.stats = statsCache;
    return ctx.next();
  })
  .use(staticFiles())
  .fsRoutes();