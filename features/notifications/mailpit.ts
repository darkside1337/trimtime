import "server-only";

import type { OutboundMessage } from "./messages";

export type MailpitTransportResult = {
  status: "captured" | "accepted" | "failed" | "unknown";
  reason: string | null;
  captureId: string | null;
  invoked: boolean;
};

function result(
  status: MailpitTransportResult["status"],
  reason: string | null,
  captureId: string | null,
  invoked: boolean,
): MailpitTransportResult {
  return { status, reason, captureId, invoked };
}

async function verifyCapture(
  origin: string,
  captureId: string,
  recipient: string,
  attemptId: string,
): Promise<MailpitTransportResult["reason"]> {
  try {
    const requestOptions = () => ({
      redirect: "error" as const,
      signal: AbortSignal.timeout(3000),
    });
    const summaryResponse = await fetch(
      `${origin}/api/v1/message/${encodeURIComponent(captureId)}`,
      requestOptions(),
    );
    if (summaryResponse.status !== 200)
      return "capture_verification_unavailable";
    const summary: unknown = await summaryResponse.json();
    if (
      !summary ||
      typeof summary !== "object" ||
      !("To" in summary) ||
      !Array.isArray(summary.To)
    ) {
      return "capture_verification_unavailable";
    }
    const recipients = summary.To as { Address?: unknown }[];
    if (
      recipients.length !== 1 ||
      typeof recipients[0]?.Address !== "string" ||
      recipients[0].Address.toLowerCase() !== recipient.toLowerCase()
    ) {
      return "capture_recipient_mismatch";
    }

    const headersResponse = await fetch(
      `${origin}/api/v1/message/${encodeURIComponent(captureId)}/headers`,
      requestOptions(),
    );
    if (headersResponse.status !== 200)
      return "capture_verification_unavailable";
    const headers: unknown = await headersResponse.json();
    if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
      return "capture_verification_unavailable";
    }
    const correlation = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === "x-trimtime-attempt-id",
    )?.[1];
    if (
      !Array.isArray(correlation) ||
      correlation.length !== 1 ||
      correlation[0] !== attemptId
    ) {
      return "capture_attempt_mismatch";
    }
    return null;
  } catch {
    return "capture_verification_unavailable";
  }
}

export async function sendMailpitMessage(input: {
  origin: string;
  message: OutboundMessage;
  attemptId: string;
  onInvoked: () => Promise<void>;
}): Promise<MailpitTransportResult> {
  let post: Response;
  let invoked = false;
  try {
    const request = fetch(`${input.origin}/api/v1/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({
        From: {
          Email: input.message.from.email,
          Name: input.message.from.name,
        },
        To: [{ Email: input.message.to }],
        Subject: input.message.subject,
        Text: input.message.text,
        Headers: { "X-TrimTime-Attempt-ID": input.attemptId },
      }),
    });
    invoked = true;
    request.catch(() => {});
    try {
      await input.onInvoked();
    } catch {
      return result("unknown", "invocation_evidence_failed", null, true);
    }
    post = await request;
  } catch {
    return result("unknown", "transport_interrupted", null, invoked);
  }

  if (post.status !== 200) {
    if (post.status === 429 || post.status >= 500) {
      return result("failed", "transient_rejection", null, true);
    }
    if (post.status >= 400 && post.status < 500) {
      return result("failed", "permanent_rejection", null, true);
    }
    return result("unknown", "transport_interrupted", null, true);
  }

  let captureId: string;
  try {
    const body: unknown = await post.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("ID" in body) ||
      typeof body.ID !== "string" ||
      !body.ID.trim()
    ) {
      return result("unknown", "malformed_success_response", null, true);
    }
    captureId = body.ID;
  } catch {
    return result("unknown", "malformed_success_response", null, true);
  }

  const verificationReason = await verifyCapture(
    input.origin,
    captureId,
    input.message.to,
    input.attemptId,
  );
  return verificationReason
    ? result("accepted", verificationReason, captureId, true)
    : result("captured", null, captureId, true);
}
