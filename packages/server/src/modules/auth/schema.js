import { z } from 'zod';

const passwordSchema = z.string().min(8, 'Password must be at least 8 characters');

export const registerSchema = z.object({
  body: z.object({
    email: z.string().trim().email('Invalid email').transform((value) => value.toLowerCase()),
    password: passwordSchema,
    name: z.string().min(1, 'Name is required'),
    store_name: z.string().trim().min(2, 'Store name is required').max(255),
    phone: z.string().optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email('Invalid email').transform((value) => value.toLowerCase()),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().trim().email('Invalid email').transform((value) => value.toLowerCase()),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().trim().min(32, 'Reset token is invalid').max(256),
    password: passwordSchema,
  }),
});
