import { z } from 'zod';

const categoryFields = {
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(1000).nullable().optional(),
  parent_id: z.coerce.number().int().positive().nullable().optional(),
};

export const createCategorySchema = z.object({
  body: z.object(categoryFields),
});

export const updateCategorySchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object(categoryFields).partial().refine(
    (value) => Object.keys(value).length > 0,
    'At least one category field is required'
  ),
});
