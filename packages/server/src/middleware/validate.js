// Zod validation middleware factory
export const validate = (schema) => {
  return (req, res, next) => {
    try {
      const result = schema.safeParse({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      if (!result.success) {
        const errors = result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));
        return res.status(400).json({ error: 'Validation failed', details: errors });
      }

      // Replace request data with parsed/sanitized values
      req.body = result.data.body ?? req.body;
      req.query = result.data.query ?? req.query;
      req.params = result.data.params ?? req.params;

      next();
    } catch (err) {
      return res.status(400).json({ error: 'Invalid request data' });
    }
  };
};
