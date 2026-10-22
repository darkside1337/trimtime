import { z } from "zod";

const range = z
  .object({
    start: z.number().int().min(0).max(1439),
    end: z.number().int().min(1).max(1440),
  })
  .strict()
  .superRefine(({ start, end }, ctx) => {
    if (start >= end)
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "End must be after start.",
      });
  });
export const dayScheduleSchema = z
  .object({ working: z.array(range), breaks: z.array(range) })
  .strict()
  .superRefine(({ working, breaks }, ctx) => {
    for (const [ranges, label] of [
      [working, "working"],
      [breaks, "breaks"],
    ] as const) {
      const ordered = ranges
        .map((range, index) => ({ ...range, index }))
        .sort((a, b) => a.start - b.start);
      for (let index = 1; index < ordered.length; index++) {
        if (ordered[index - 1]!.end > ordered[index]!.start)
          ctx.addIssue({
            code: "custom",
            path: [label, ordered[index]!.index, "start"],
            message: `${label} ranges cannot overlap.`,
          });
      }
    }
    for (const [index, item] of breaks.entries()) {
      if (
        !working.some(
          ({ start, end }) => start <= item.start && item.end <= end,
        )
      )
        ctx.addIssue({
          code: "custom",
          path: ["breaks", index, "start"],
          message: "Each break must fit inside working hours.",
        });
    }
  });

export const weeklyScheduleSchema = z.array(dayScheduleSchema).length(7);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
    );
  });
export const dateScheduleSchema = z
  .object({
    date: dateSchema,
    timeZone: z.string().min(1),
    override: dayScheduleSchema.nullable(),
    closed: z.boolean(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export const saveShopDateScheduleSchema = dateScheduleSchema;
export const saveBarberDateScheduleSchema = dateScheduleSchema
  .extend({ barberId: z.string().uuid() })
  .strict();
export const getDateAvailabilitySchema = z
  .object({ date: dateSchema })
  .strict();
export const createTimeBlockSchema = z
  .object({
    barberId: z.string().uuid(),
    date: dateSchema,
    timeZone: z.string().min(1),
    start: z
      .string()
      .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:00(?:\.000)?Z$/)
      .refine(
        (value) =>
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString().replace(".000Z", "Z") ===
            value.replace(".000Z", "Z"),
      ),
    end: z
      .string()
      .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:00(?:\.000)?Z$/)
      .refine(
        (value) =>
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString().replace(".000Z", "Z") ===
            value.replace(".000Z", "Z"),
      ),
    note: z.string().trim().max(500).optional().default(""),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (Date.parse(data.start) >= Date.parse(data.end))
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "End must be after start.",
      });
  });
export const removeTimeBlockSchema = z
  .object({ id: z.string().uuid() })
  .strict();
export const blockBoundarySchema = z
  .object({ date: dateSchema, minute: z.number().int().min(0).max(1440) })
  .strict();
export const saveShopScheduleSchema = z
  .object({
    week: weeklyScheduleSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict();
export const saveBarberScheduleSchema = saveShopScheduleSchema
  .extend({ barberId: z.string().uuid() })
  .strict();
export const previewSlotsSchema = z
  .object({
    serviceId: z.string().uuid(),
    barberId: z.string().uuid(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return (
          !Number.isNaN(parsed.valueOf()) &&
          parsed.toISOString().slice(0, 10) === value
        );
      }),
  })
  .strict();

export type SaveShopScheduleInput = z.infer<typeof saveShopScheduleSchema>;
export type SaveBarberScheduleInput = z.infer<typeof saveBarberScheduleSchema>;
export type PreviewSlotsInput = z.infer<typeof previewSlotsSchema>;
