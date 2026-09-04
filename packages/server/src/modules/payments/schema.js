import { z } from 'zod';

export const recordPaymentSchema = z.object({
  body: z.object({
    order_id: z.coerce.number().int().positive(),
    amount: z.coerce.number().positive(),
    method: z.enum(['cash', 'card', 'transfer']),
    reference: z.string().trim().max(255).optional(),
  }).superRefine((payment, context) => {
    if (payment.method !== 'cash' && !payment.reference) {
      context.addIssue({
        code: 'custom',
        path: ['reference'],
        message: 'A payment reference is required for card and transfer payments',
      });
    }
  }),
});
