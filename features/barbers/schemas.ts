import { z } from "zod";

export const saveBarberSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "This field is required."),
    serviceIds: z
      .array(z.string().uuid())
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();
