import { describe, expect, it } from "vitest";
import { resolveEmailConfig } from "../config";

describe("email configuration", () => {
  const enabled = {
    EMAIL_MODE: "mailpit",
    APP_ORIGIN: "http://localhost:3100",
    MARKETING_ORIGIN: "http://localtest.me:3100",
    MAILPIT_ORIGIN: "http://127.0.0.1:8025",
  };

  it("permits explicitly enabled Mailpit for a local production build", () => {
    expect(
      resolveEmailConfig({
        NODE_ENV: "production",
        MARKETING_ORIGIN: "http://localhost:3100",
        APP_ORIGIN: "http://app.localhost:3100",
        EMAIL_MODE: "mailpit",
        MAILPIT_ORIGIN: "http://127.0.0.1:8025",
      }),
    ).toEqual({ mode: "mailpit", origin: "http://127.0.0.1:8025" });
  });

  it("is disabled unless Mailpit is explicitly enabled", () => {
    expect(resolveEmailConfig({})).toEqual({
      mode: "unavailable",
      reason: "disabled",
    });
  });

  it("rejects hosted application origins", () => {
    expect(
      resolveEmailConfig({
        ...enabled,
        APP_ORIGIN: "https://trimtime.example",
      }),
    ).toEqual({ mode: "unavailable", reason: "hosted" });
  });

  it("rejects any Vercel environment", () => {
    expect(resolveEmailConfig({ ...enabled, VERCEL: "1" })).toEqual({
      mode: "unavailable",
      reason: "hosted",
    });
  });

  it.each([
    "https://127.0.0.1:8025",
    "http://mailpit.example:8025",
    "http://user:pass@127.0.0.1:8025",
    "http://127.0.0.1:8025/api",
    "http://127.0.0.1:8025/?token=x",
    "http://127.0.0.1:8025/#capture",
  ])("rejects unsafe Mailpit origin %s", (MAILPIT_ORIGIN) => {
    expect(resolveEmailConfig({ ...enabled, MAILPIT_ORIGIN })).toEqual({
      mode: "unavailable",
      reason: "invalid_config",
    });
  });

  it.each([
    "not a URL",
    "ftp://localhost:3100",
    "http://localhost:3100/path",
    "http://localhost:3100/api/..",
    "http://localhost:3100?",
    "http://localhost:3100#",
  ])("rejects invalid application origin %s", (APP_ORIGIN) => {
    expect(resolveEmailConfig({ ...enabled, APP_ORIGIN })).toEqual({
      mode: "unavailable",
      reason: "invalid_config",
    });
  });

  it("permits local HTTPS application origins", () => {
    expect(
      resolveEmailConfig({
        ...enabled,
        APP_ORIGIN: "https://app.localhost:3443",
        MARKETING_ORIGIN: "https://shop.localtest.me:3443",
      }),
    ).toEqual({ mode: "mailpit", origin: "http://127.0.0.1:8025" });
  });
});
