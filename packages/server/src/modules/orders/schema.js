import { z } from 'zod';

export const refundOrderSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    reason: z.string().trim().min(3, 'Give a short reason for the refund').max(500),
    restock: z.boolean().optional().default(true),
  }),
});

const orderItemSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive(),
  discount: z.coerce.number().min(0).optional().default(0),
});

export const createOrderSchema = z.object({
  body: z.object({
    items: z.array(orderItemSchema).min(1),
    customer_id: z.coerce.number().int().positive().nullable().optional(),
    payment_method: z.enum(['cash', 'card', 'transfer']).default('cash'),
    payment_reference: z.string().trim().max(255).optional(),
    discount_amount: z.coerce.number().min(0).optional().default(0),
    notes: z.string().trim().max(1000).optional(),
    client_order_id: z.string().trim().min(8).max(100).optional(),
  }).superRefine((order, context) => {
    if (order.payment_method !== 'cash' && !order.payment_reference) {
      context.addIssue({
        code: 'custom',
        path: ['payment_reference'],
        message: 'Payment reference is required for card and transfer sales',
      });
    }
  }),
});
