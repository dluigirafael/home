import { page } from "fresh";
import { define } from "../utils.ts";
import { gatherStats } from "../server/stats.ts";
import Dashboard from "@/islands/Dashboard.tsx";

export const handler = define.handlers({
  async GET() {
    return page({ stats: await gatherStats() });
  },
});

export default define.page<typeof handler>(({ data }) => (
  <div class="card">
    <Dashboard initialStats={data.stats} />
  </div>
));