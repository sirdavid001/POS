import { z } from 'zod';

export const checkoutSchema = z.object({
  provider: z.enum(['paystack', 'flutterwave']),
  plan_code: z.enum(['activation_5m', 'monthly', 'quarterly', 'yearly']),
  currency: z.string()
    .trim()
    .length(3, 'Currency must be a 3-letter ISO code')
    .transform((value) => value.toUpperCase())
    .optional(),
  locale: z.string().trim().max(80).optional(),
  time_zone: z.string().trim().max(120).optional(),
  country: z.string().trim().length(2).transform((value) => value.toUpperCase()).optional(),
  legal_acknowledged: z.literal(true, {
    error: 'Accept the Terms of Service and Refund Policy before payment',
  }),
});

export const paymentConfirmationSchema = z.object({
  provider: z.enum(['paystack', 'flutterwave']),
  reference: z.string().trim().min(1).max(255),
  transaction_id: z.union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine(Boolean, 'Transaction ID cannot be empty')
    .optional(),
});
