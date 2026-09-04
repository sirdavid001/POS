import { z } from 'zod';

const productImageSchema = z.union([
  z.string().trim().max(2048).refine(
    (value) => value.startsWith('/') || /^https?:\/\//i.test(value),
    'Image URL must use HTTP(S) or be a site-relative path'
  ),
  z.string().max(250_000).refine(
    (value) => /^data:image\/(?:jpeg|png|webp);base64,/i.test(value),
    'Uploaded image must be a JPEG, PNG, or WebP data URL'
  ),
]).nullable().optional();

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(255),
    description: z.string().max(2000).optional(),
    category_id: z.number().int().positive().optional(),
    sku: z.string().trim().max(100).optional(),
    barcode: z.string().trim().max(100).optional(),
    image_url: productImageSchema,
    price: z.number().positive(),
    cost_price: z.number().min(0).optional(),
    stock_quantity: z.number().int().min(0).default(0),
    low_stock_threshold: z.number().int().min(0).default(10),
  }),
});

export const updateProductSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    category_id: z.number().int().positive().nullable().optional(),
    sku: z.string().trim().max(100).optional(),
    barcode: z.string().trim().max(100).optional(),
    image_url: productImageSchema,
    price: z.number().positive().optional(),
    cost_price: z.number().min(0).optional(),
    stock_quantity: z.number().int().min(0).optional(),
    low_stock_threshold: z.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
  }),
});
