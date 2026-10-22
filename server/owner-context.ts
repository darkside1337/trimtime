import "server-only";
import { auth } from "@/server/auth";

export type OwnerContext = { userId: string };

export async function readOwnerContext(
  headers: Headers,
): Promise<OwnerContext | null> {
  const session = await auth.api.getSession({ headers });
  return session ? { userId: session.user.id } : null;
}
