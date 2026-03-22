import { Router } from 'express';
import { getProducts, getProduct, createProduct, updateProduct, deleteProduct, getLowStock } from './controller.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { createProductSchema, updateProductSchema } from './schema.js';

const router = Router();

router.use(authenticate);

router.get('/', getProducts);
router.get('/low-stock', getLowStock);
router.get('/:id', getProduct);
router.post('/', authorize('admin', 'manager'), validate(createProductSchema), createProduct);
router.patch('/:id', authorize('admin', 'manager'), validate(updateProductSchema), updateProduct);
router.delete('/:id', authorize('admin', 'manager'), deleteProduct);

export default router;
