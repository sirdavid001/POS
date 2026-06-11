import { z } from 'zod';

const optionalText = (max = 255) =>
  z.string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

export const supportContactSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Name is required').max(120),
    email: z.string().trim().email('Enter a valid email address').transform((value) => value.toLowerCase()),
    phone: optionalText(50),
    store_name: optionalText(255),
    category: z.enum([
      'billing',
      'account',
      'downloads',
      'installation',
      'technical',
      'security',
      'privacy',
      'other',
    ]),
    priority: z.enum(['normal', 'urgent']).default('normal'),
    platform: z.enum(['windows', 'android', 'macos', 'linux', 'ios', 'web', 'other']).default('other'),
    app_version: optionalText(80),
    subject: z.string().trim().min(4, 'Subject is required').max(160),
    message: z.string().trim().min(20, 'Please describe the issue in at least 20 characters').max(4000),
    contact_permission: z.literal(true, {
      errorMap: () => ({ message: 'Confirm that QuickPOS may contact you about this request' }),
    }),
    website: z.string().trim().optional(),
  }),
});
