import { useState } from 'react';
import { useExportCard } from './useExportCard';
import { useSubscription } from '../context/SubscriptionContext';

// Combines useExportCard with the Pro entitlement check: tapping export
// either captures+shares (if the user has access) or opens the paywall.
export function useGatedExport() {
  const { hasAccess } = useSubscription();
  const { ref, exportCard, exporting } = useExportCard();
  const [showPaywall, setShowPaywall] = useState(false);

  const onExportPress = () => {
    if (hasAccess) exportCard();
    else setShowPaywall(true);
  };

  return { ref, onExportPress, exporting, showPaywall, setShowPaywall };
}
