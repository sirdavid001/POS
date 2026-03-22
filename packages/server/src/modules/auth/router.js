import { Router } from 'express';
import { register, login, refreshAccessToken, logout, getMe } from './controller.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { registerSchema, loginSchema, refreshSchema } from './schema.js';

const router = Router();

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/refresh', validate(refreshSchema), refreshAccessToken);
router.post('/logout', logout);
router.get('/me', authenticate, getMe);

export default router;
