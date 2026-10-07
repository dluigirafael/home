import { createDefine } from "fresh";
import type { State } from "./server/config.ts";

export const define = createDefine<State>();