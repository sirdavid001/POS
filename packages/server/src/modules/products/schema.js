import { z } from 'zod';

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    category_id: z.number().int().positive().optional(),
    sku: z.string().optional(),
    barcode: z.string().optional(),
    image_url: z.string().optional(),
    price: z.number().positive(),
    cost_price: z.number().min(0).optional(),
    stock_quantity: z.number().int().min(0).default(0),
    low_stock_threshold: z.number().int().min(0).default(10),
  }),
});

export const updateProductSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    category_id: z.number().int().positive().nullable().optional(),
    sku: z.string().optional(),
    barcode: z.string().optional(),
    image_url: z.string().optional(),
    price: z.number().positive().optional(),
    cost_price: z.number().min(0).optional(),
    stock_quantity: z.number().int().min(0).optional(),
    low_stock_threshold: z.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
  }),
});
