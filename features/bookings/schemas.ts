import { z } from "zod";

export const publicBookingContactSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name."),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    phone: z.string().trim().min(1, "Enter a phone number.").optional(),
    whatsappOptIn: z.boolean(),
  })
  .strict()
  .refine((contact) => !contact.whatsappOptIn || Boolean(contact.phone), {
    path: ["phone"],
    message: "Enter a phone number to receive WhatsApp updates.",
  });

export type PublicBookingContact = z.infer<typeof publicBookingContactSchema>;

export const createPublicBookingSchema = z
  .object({
    serviceId: z.string().min(1),
    barberId: z.string().min(1),
    startAt: z.iso.datetime({ offset: true }),
    reviewedOffer: z
      .object({
        name: z.string().trim().min(1),
        priceUsd: z.string().regex(/^\d+\.\d{2}$/),
        durationMinutes: z.string().regex(/^\d+$/),
      })
      .strict(),
    contact: publicBookingContactSchema,
    recoveryKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict()
  .refine(
    ({ startAt }) =>
      new Date(startAt).getUTCSeconds() === 0 &&
      new Date(startAt).getUTCMilliseconds() === 0,
    {
      path: ["startAt"],
      message: "Choose a start on an exact minute.",
    },
  );

export type CreatePublicBookingInput = z.infer<
  typeof createPublicBookingSchema
>;
