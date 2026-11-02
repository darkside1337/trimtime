import { createHash, timingSafeEqual } from "node:crypto";
import { processNotificationRetries } from "@/features/notifications/retry-worker";
import { classifyHost } from "@/server/hosts";

export const maxDuration = 60;

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function matchesSecret(provided: string, configured: string) {
  const providedDigest = createHash("sha256").update(provided).digest();
  const configuredDigest = createHash("sha256").update(configured).digest();
  return timingSafeEqual(providedDigest, configuredDigest);
}

function methodNotAllowed(request: Request) {
  if (classifyHost(request.headers) !== "owner") {
    return json({ error: "Not found." }, 404);
  }
  return json({ error: "Method not allowed." }, 405);
}

export async function GET(request: Request) {
  return methodNotAllowed(request);
}

export async function HEAD(request: Request) {
  return methodNotAllowed(request);
}

export async function PUT(request: Request) {
  return methodNotAllowed(request);
}

export async function PATCH(request: Request) {
  return methodNotAllowed(request);
}

export async function DELETE(request: Request) {
  return methodNotAllowed(request);
}

export async function OPTIONS(request: Request) {
  return methodNotAllowed(request);
}

export async function POST(request: Request) {
  if (classifyHost(request.headers) !== "owner") {
    return json({ error: "Not found." }, 404);
  }

  const configuredSecret = process.env.NOTIFICATION_JOB_SECRET;
  const providedSecret = request.headers.get("x-trimtime-job-secret");
  if (!configuredSecret || configuredSecret.length < 32) {
    return json({ error: "Notification job is not configured." }, 503);
  }
  if (!providedSecret || !matchesSecret(providedSecret, configuredSecret)) {
    return json({ error: "Unauthorized." }, 401);
  }

  if (new URL(request.url).searchParams.size > 0) {
    return json({ error: "Request parameters are not accepted." }, 400);
  }

  if ((await request.text()).length > 0) {
    return json({ error: "Request body is not accepted." }, 400);
  }

  try {
    const summary = await processNotificationRetries();
    return json(
      {
        processed: summary.processed,
        attempted: summary.attempted,
        reconciled: summary.reconciled,
        recoveredUnknown: summary.recoveredUnknown,
        suppressed: summary.suppressed,
      },
      200,
    );
  } catch {
    return json({ error: "Notification processing failed." }, 500);
  }
}
