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
      if (result.data.body !== undefined) req.body = result.data.body;
      if (result.data.params !== undefined) req.params = result.data.params;
      if (result.data.query !== undefined) {
        // Express 5 exposes req.query through a getter. Define a request-local
        // value instead of assigning to the read-only prototype property.
        Object.defineProperty(req, 'query', {
          configurable: true,
          enumerable: true,
          value: result.data.query,
        });
      }

      next();
    } catch {
      return res.status(400).json({ error: 'Invalid request data' });
    }
  };
};
