import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import { REVENUECAT_API_KEYS, PRO_ENTITLEMENT_ID, DEFAULT_OFFERING_ID, TRIAL_DAYS } from '../config/subscription';

const SubscriptionContext = createContext(null);

// Signup-based free trial (no payment method required): every account gets
// TRIAL_DAYS of full access starting from auth.users.created_at. After that,
// access to gated features requires an active RevenueCat "pro" entitlement.
function trialInfo(user) {
  if (!user?.created_at) return { isInTrial: false, trialDaysLeft: 0, trialEndsAt: null };
  const trialEndsAt = new Date(new Date(user.created_at).getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const msLeft = trialEndsAt.getTime() - Date.now();
  return {
    isInTrial: msLeft > 0,
    trialDaysLeft: Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000))),
    trialEndsAt,
  };
}

export function SubscriptionProvider({ children }) {
  const { user } = useAuth();
  const [customerInfo, setCustomerInfo] = useState(null);
  const [offerings, setOfferings] = useState(null);
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const refreshAdminFlags = useCallback(() => {
    if (!user?.id) { setIsAdmin(false); setIsSuperAdmin(false); return; }
    supabase.from('profiles').select('is_admin, is_super_admin').eq('id', user.id).single()
      .then(({ data }) => {
        setIsAdmin(!!data?.is_admin);
        setIsSuperAdmin(!!data?.is_super_admin);
      })
      .catch(() => { setIsAdmin(false); setIsSuperAdmin(false); });
  }, [user?.id]);

  useEffect(() => { refreshAdminFlags(); }, [refreshAdminFlags]);

  const setUserAdmin = useCallback(async (email, makeAdmin) => {
    const { error } = await supabase.rpc('set_user_admin', { target_email: email, make_admin: makeAdmin });
    if (error) throw error;
  }, []);

  useEffect(() => {
    const apiKey = Platform.OS === 'ios' ? REVENUECAT_API_KEYS.ios : REVENUECAT_API_KEYS.android;
    try {
      Purchases.configure({ apiKey });
      if (__DEV__) Purchases.setLogLevel('DEBUG');
      setConfigured(true);
    } catch (e) {
      // Placeholder/invalid key (e.g. before RevenueCat is set up, or running
      // on web) — fall back to trial-only gating rather than crashing the app.
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!configured || !user?.id) return;
    Purchases.logIn(user.id).catch(() => {});
  }, [configured, user?.id]);

  const refresh = useCallback(async () => {
    if (!configured) return;
    try {
      const [info, offs] = await Promise.all([
        Purchases.getCustomerInfo(),
        Purchases.getOfferings(),
      ]);
      setCustomerInfo(info);
      setOfferings(offs);
    } catch (e) {
      // RevenueCat not reachable (e.g. running in Expo Go, or no network) —
      // fall back to trial-only gating rather than crashing the app.
    } finally {
      setReady(true);
    }
  }, [configured]);

  useEffect(() => {
    if (!configured) return;
    refresh();
    const listener = (info) => setCustomerInfo(info);
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => Purchases.removeCustomerInfoUpdateListener(listener);
  }, [configured, refresh]);

  // App-side mirror of RevenueCat status into a queryable table, so the admin
  // dashboard has something to show. This only reflects what this device has
  // seen — a real cross-user feed would need RevenueCat webhooks server-side.
  useEffect(() => {
    if (!user?.id || !customerInfo) return;
    const entitlement = customerInfo.entitlements?.active?.[PRO_ENTITLEMENT_ID];
    supabase.from('subscriptions').upsert({
      user_id: user.id,
      status: entitlement ? 'active' : 'none',
      plan_id: entitlement?.productIdentifier ?? null,
      store: entitlement?.store ?? null,
      period_end: entitlement?.expirationDate ?? null,
    }).then(() => {}).catch(() => {});
  }, [user?.id, customerInfo]);

  const isPro = isAdmin || !!customerInfo?.entitlements?.active?.[PRO_ENTITLEMENT_ID];
  const { isInTrial, trialDaysLeft, trialEndsAt } = trialInfo(user);
  const hasAccess = isAdmin || isPro || isInTrial;

  const currentOffering = offerings?.all?.[DEFAULT_OFFERING_ID] ?? offerings?.current ?? null;

  const purchasePackage = useCallback(async (pkg) => {
    if (!configured) throw new Error('Purchases are not available yet.');
    const { customerInfo: info } = await Purchases.purchasePackage(pkg);
    setCustomerInfo(info);
    if (user?.id && pkg?.product?.priceString) {
      supabase.from('subscriptions').update({ price_string: pkg.product.priceString }).eq('user_id', user.id)
        .then(() => {}).catch(() => {});
    }
    return info;
  }, [configured, user?.id]);

  const restorePurchases = useCallback(async () => {
    if (!configured) throw new Error('Purchases are not available yet.');
    const info = await Purchases.restorePurchases();
    setCustomerInfo(info);
    return info;
  }, [configured]);

  return (
    <SubscriptionContext.Provider
      value={{
        ready,
        isAdmin,
        isSuperAdmin,
        setUserAdmin,
        refreshAdminFlags,
        isPro,
        isInTrial,
        trialDaysLeft,
        trialEndsAt,
        hasAccess,
        offering: currentOffering,
        purchasePackage,
        restorePurchases,
        refresh,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export const useSubscription = () => useContext(SubscriptionContext);
