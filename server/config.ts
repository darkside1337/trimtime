import "server-only";
import { resolveServerOrigins } from "./origin-config.mts";

export const serverOrigins = resolveServerOrigins(process.env);
