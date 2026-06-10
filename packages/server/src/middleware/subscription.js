export function requireActiveSubscription(options = {}) {
  const allowedMutations = new Set(options.allowedMutations || []);

  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || allowedMutations.has(`${req.method} ${req.path}`)) {
      return next();
    }

    if (req.subscription?.can_write) {
      return next();
    }

    return res.status(402).json({
      error: req.subscription?.activation_required
        ? 'Complete the ₦20,000 initial activation to use QuickPOS.'
        : 'Your QuickPOS subscription has expired. Renew to make changes.',
      code: req.subscription?.activation_required
        ? 'INITIAL_ACTIVATION_REQUIRED'
        : 'SUBSCRIPTION_EXPIRED',
      subscription: req.subscription,
    });
  };
}
