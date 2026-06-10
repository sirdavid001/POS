import { Router } from 'express';
import {
  forgotPassword,
  getMe,
  login,
  logout,
  refreshAccessToken,
  register,
  resetPassword,
} from './controller.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from './schema.js';

const router = Router();

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);
router.post('/refresh', validate(refreshSchema), refreshAccessToken);
router.post('/logout', logout);
router.get('/me', authenticate, getMe);

export default router;
