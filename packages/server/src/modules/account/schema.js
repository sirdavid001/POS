import { z } from 'zod';

const optionalText = (max = 255) =>
  z.string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

const optionalNullableText = (max = 255) =>
  z.string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value === '' ? null : value);

const optionalPassword = z.string()
  .min(8, 'Password must be at least 8 characters')
  .optional()
  .transform((value) => value || undefined);

const optionalTaxRate = z.preprocess(
  (value) => {
    if (value === '' || value == null) return undefined;
    return Number(value);
  },
  z.number().min(0).max(100).optional()
);

export const profileSchema = z.object({
  body: z.object({
    name: optionalText().refine((value) => value === undefined || value.length >= 1, 'Name is required'),
    phone: optionalNullableText(50),
    email: z.string()
      .trim()
      .email('Invalid email')
      .optional()
      .transform((value) => value?.toLowerCase()),
    password: optionalPassword,
  }).refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Provide at least one profile field to update'
  ),
});

export const storeSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Store name is required').max(255).optional(),
    address: optionalNullableText(1000),
    phone: optionalNullableText(50),
    email: z.string()
      .trim()
      .email('Invalid store email')
      .optional()
      .or(z.literal('').transform(() => null)),
    tax_rate: optionalTaxRate,
    currency: z.string().trim().min(3).max(10).optional(),
    receipt_header: optionalNullableText(1000),
    receipt_footer: optionalNullableText(1000),
  }).refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Provide at least one store field to update'
  ),
});
