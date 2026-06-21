import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import { useAuth } from './AuthContext';
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

  useEffect(() => {
    const apiKey = Platform.OS === 'ios' ? REVENUECAT_API_KEYS.ios : REVENUECAT_API_KEYS.android;
    Purchases.configure({ apiKey });
    if (__DEV__) Purchases.setLogLevel('DEBUG');
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    Purchases.logIn(user.id).catch(() => {});
  }, [user?.id]);

  const refresh = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    refresh();
    const listener = (info) => setCustomerInfo(info);
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => Purchases.removeCustomerInfoUpdateListener(listener);
  }, [refresh]);

  const isPro = !!customerInfo?.entitlements?.active?.[PRO_ENTITLEMENT_ID];
  const { isInTrial, trialDaysLeft, trialEndsAt } = trialInfo(user);
  const hasAccess = isPro || isInTrial;

  const currentOffering = offerings?.all?.[DEFAULT_OFFERING_ID] ?? offerings?.current ?? null;

  const purchasePackage = useCallback(async (pkg) => {
    const { customerInfo: info } = await Purchases.purchasePackage(pkg);
    setCustomerInfo(info);
    return info;
  }, []);

  const restorePurchases = useCallback(async () => {
    const info = await Purchases.restorePurchases();
    setCustomerInfo(info);
    return info;
  }, []);

  return (
    <SubscriptionContext.Provider
      value={{
        ready,
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
