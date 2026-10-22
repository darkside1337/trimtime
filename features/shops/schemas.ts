import { z } from "zod";

const requiredText = z.string().trim().min(1, "This field is required.");
const timeZone = z.string().refine(
  (value) => {
    if (/^[+-]\d{2}:\d{2}$/.test(value)) return false;
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  "Enter a valid IANA time zone, such as America/New_York or UTC.",
);
const reservedSubdomains = new Set(["app", "www", "api", "admin"]);
const subdomain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, "Use 1–63 letters or numbers, with hyphens only between them.")
  .refine((value) => !reservedSubdomains.has(value), "This subdomain is reserved.");

export const createShopSchema = z
  .object({
    name: requiredText,
    subdomain,
    timeZone,
    publicContact: requiredText,
    address: requiredText,
  })
  .strict();

export const updateShopSchema = z
  .object({
    name: requiredText,
    publicContact: requiredText,
    timeZone,
  })
  .strict();

export const subdomainAvailabilitySchema = createShopSchema.pick({ subdomain: true });
