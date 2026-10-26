import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request body too large");
  }
  return JSON.parse(body);
}

function recipientBehavior(recipient) {
  const local = recipient.slice(0, recipient.indexOf("@")).toLowerCase();
  if (local.startsWith("success-")) return {};
  if (local.startsWith("reject-429-")) return { status: 429 };
  if (local.startsWith("reject-5xx-")) return { status: 503 };
  if (local.startsWith("reject-4xx-")) return { status: 400 };
  if (local.startsWith("delay-")) return { delay: 2_200 };
  if (local.startsWith("timeout-")) return { delay: 3_500 };
  if (local.startsWith("mismatch-recipient-"))
    return { mismatchRecipient: true };
  if (local.startsWith("mismatch-header-")) return { mismatchHeader: true };
  return {};
}

export function createMailpitDouble() {
  const messages = new Map();
  let nextId = 1;
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json(response, 200, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/send") {
      let input;
      try {
        input = await readJson(request);
      } catch {
        return json(response, 400, { error: "invalid_request" });
      }
      const recipient = input?.To?.length === 1 ? input.To[0]?.Email : null;
      if (
        typeof recipient !== "string" ||
        !["@trimtime.test", "@example.test"].some((domain) =>
          recipient.endsWith(domain),
        )
      ) {
        return json(response, 400, { error: "invalid_recipient" });
      }
      const behavior = recipientBehavior(recipient);
      if (behavior.status)
        return json(response, behavior.status, {
          error: "synthetic_rejection",
        });
      const id = `test-message-${nextId++}`;
      const attempt = input?.Headers?.["X-TrimTime-Attempt-ID"] ?? "";
      messages.set(id, {
        recipient: behavior.mismatchRecipient
          ? `wrong-${recipient}`
          : recipient,
        headers: {
          "X-TrimTime-Attempt-ID": [
            behavior.mismatchHeader ? `wrong-${attempt}` : attempt,
          ],
        },
      });
      if (behavior.delay) {
        await new Promise((resolve) => setTimeout(resolve, behavior.delay));
        if (response.destroyed) return;
      }
      return json(response, 200, { ID: id });
    }

    const match = url.pathname.match(
      /^\/api\/v1\/message\/([^/]+)(\/headers)?$/,
    );
    if (request.method === "GET" && match) {
      let id;
      try {
        id = decodeURIComponent(match[1]);
      } catch {
        return json(response, 404, { error: "message_not_found" });
      }
      const message = messages.get(id);
      if (!message) return json(response, 404, { error: "message_not_found" });
      return json(
        response,
        200,
        match[2] ? message.headers : { To: [{ Address: message.recipient }] },
      );
    }

    return json(response, 404, { error: "not_found" });
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  createMailpitDouble().listen(8027, "127.0.0.1");
}
