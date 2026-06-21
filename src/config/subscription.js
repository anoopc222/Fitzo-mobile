// RevenueCat configuration. Replace these with real values from your
// RevenueCat dashboard once the Apple/Google subscription products exist.
export const REVENUECAT_API_KEYS = {
  ios: 'appl_REPLACE_ME',
  android: 'goog_REPLACE_ME',
};

// The entitlement identifier configured in RevenueCat (RevenueCat > Entitlements).
export const PRO_ENTITLEMENT_ID = 'pro';

// The offering identifier to fetch packages from (RevenueCat > Offerings).
export const DEFAULT_OFFERING_ID = 'default';

export const TRIAL_DAYS = 14;

// Accounts that always get Pro access, bypassing trial/entitlement checks —
// for internal testing and reviewers. Match by Supabase auth user id or email.
export const ADMIN_OVERRIDE_USER_IDS = [
  // 'a1b2c3d4-...-...-...-...',
];

export const ADMIN_OVERRIDE_EMAILS = [
  // 'you@example.com',
];

