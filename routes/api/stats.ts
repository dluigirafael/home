import { define } from "../../utils.ts";
import { gatherStats } from "../../server/stats.ts";

export const handler = define.handlers({
  async GET() {
    return Response.json(await gatherStats());
  },
});