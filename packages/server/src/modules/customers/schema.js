import { z } from 'zod';

const optionalText = (max) => z.string().trim().max(max).nullable().optional();

const customerFields = {
  name: z.string().trim().min(1).max(255),
  email: z.union([z.email(), z.literal('')]).nullable().optional(),
  phone: optionalText(50),
  address: optionalText(1000),
  notes: optionalText(2000),
};

export const createCustomerSchema = z.object({
  body: z.object(customerFields),
});

export const updateCustomerSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({
    ...customerFields,
    loyalty_points: z.coerce.number().int().min(0).optional(),
  }).partial().refine(
    (value) => Object.keys(value).length > 0,
    'At least one customer field is required'
  ),
});
