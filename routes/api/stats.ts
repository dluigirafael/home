import { define } from "../../utils.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const cached = ctx.state.stats.peek();
    if (cached) return Response.json(cached);
    const fresh = await ctx.state.stats.get();
    return Response.json(fresh);
  },
});