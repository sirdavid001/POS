export function requireActiveSubscription(options = {}) {
  const allowedMutations = new Set(options.allowedMutations || []);

  return (req, res, next) => {
    if (req.method === 'OPTIONS' || allowedMutations.has(`${req.method} ${req.path}`)) {
      return next();
    }

    if (req.subscription?.can_write) {
      return next();
    }

    return res.status(402).json({
      error: req.subscription?.activation_required
        ? 'Complete store activation to use QuickPOS.'
        : 'Your QuickPOS subscription has expired. Renew to restore store access.',
      code: req.subscription?.activation_required
        ? 'INITIAL_ACTIVATION_REQUIRED'
        : 'SUBSCRIPTION_EXPIRED',
      subscription: req.subscription,
    });
  };
}
