import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';

const MoreMenuContext = createContext(null);

export function MoreMenuProvider({ children }) {
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const value = useMemo(() => ({ visible, open, close }), [visible, open, close]);
  return <MoreMenuContext.Provider value={value}>{children}</MoreMenuContext.Provider>;
}

export function useMoreMenu() {
  const ctx = useContext(MoreMenuContext);
  if (!ctx) throw new Error('useMoreMenu must be used within MoreMenuProvider');
  return ctx;
}
