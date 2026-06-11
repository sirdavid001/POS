import { z } from 'zod';

export const checkoutSchema = z.object({
  provider: z.enum(['paystack', 'flutterwave']),
  plan_code: z.enum(['activation_5m', 'monthly', 'quarterly', 'yearly']),
  legal_acknowledged: z.literal(true, {
    errorMap: () => ({ message: 'Accept the Terms of Service and Refund Policy before payment' }),
  }),
});
