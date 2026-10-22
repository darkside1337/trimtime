import { betterAuth } from "better-auth";
import { ownerAuthOptions } from "./auth-options";

export const auth = betterAuth(ownerAuthOptions);
