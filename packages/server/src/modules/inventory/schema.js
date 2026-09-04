import { z } from 'zod';

const optionalText = (max) => z.string().trim().max(max).optional();

export const adjustStockSchema = z.object({
  body: z.object({
    product_id: z.coerce.number().int().positive(),
    type: z.enum(['in', 'out', 'adjustment']),
    quantity: z.coerce.number().int().positive(),
    reason: optionalText(1000),
    supplier_id: z.coerce.number().int().positive().nullable().optional(),
  }),
});

export const createSupplierSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(255),
    contact_name: optionalText(255),
    email: z.email().optional(),
    phone: optionalText(50),
    address: optionalText(1000),
  }),
});

export const updateSupplierSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: createSupplierSchema.shape.body.partial().refine(
    (value) => Object.keys(value).length > 0,
    'At least one supplier field is required'
  ),
});

const purchaseOrderItemSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive(),
  unit_cost: z.coerce.number().min(0),
});

export const createPurchaseOrderSchema = z.object({
  body: z.object({
    supplier_id: z.coerce.number().int().positive(),
    items: z.array(purchaseOrderItemSchema).min(1),
    notes: optionalText(1000),
  }),
});
