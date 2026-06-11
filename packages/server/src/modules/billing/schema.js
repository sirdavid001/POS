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
  legal_acknowledged: z.literal(true, {
    errorMap: () => ({ message: 'Accept the Terms of Service and Refund Policy before payment' }),
  }),
});
