import { page } from "fresh";
import { define } from "../utils.ts";
import Dashboard from "@/islands/Dashboard.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const stats = await ctx.state.stats.get();
    return page({ stats });
  },
});

export default define.page<typeof handler>(({ data }) => {
  return (
    <div class="card">
      <Dashboard initialStats={data.stats} />
    </div>
  );
});