import { classifyHost } from "@/server/hosts";

async function guard(request: Request, method: "GET" | "POST") {
  if (classifyHost(request.headers) !== "owner") return new Response("Not found", { status: 404 });
  const [{ toNextJsHandler }, { auth }] = await Promise.all([
    import("better-auth/next-js"),
    import("@/server/auth"),
  ]);
  const handler = toNextJsHandler(auth);
  return handler[method](request);
}
export const GET = (request: Request) => guard(request, "GET");
export const POST = (request: Request) => guard(request, "POST");
