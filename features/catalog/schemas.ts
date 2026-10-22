import { z } from "zod";

const price = z
  .string()
  .trim()
  .regex(
    /^\d+(?:\.\d{1,2})?$/,
    "Enter a USD amount with up to two decimal places.",
  )
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
  });

const duration = z
  .string()
  .trim()
  .regex(/^\d+$/, "Enter a whole number of minutes.")
  .refine(
    (value) => /^\d+$/.test(value) && BigInt(value) >= BigInt(30),
    "Duration must be at least 30 minutes.",
  )
  .transform((value) => BigInt(value).toString());

export const saveServiceSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "This field is required."),
    priceUsd: price,
    durationMinutes: duration,
    offered: z.boolean(),
    barberIds: z.array(z.string().uuid()).transform((ids) => [...new Set(ids)]),
  })
  .strict();
