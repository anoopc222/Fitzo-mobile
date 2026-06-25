import { QueryClient } from '@tanstack/react-query';

// gcTime must be >= the persister's maxAge in App.js, otherwise React Query
// garbage collects (and the persister drops) cached queries before they'd
// ever be restored.
export const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is fetched fresh on every screen-mount-after-mutation via explicit
      // invalidateQueries() calls, so a non-zero staleTime here only avoids
      // redundant refetches on quick re-mounts/focus, it never serves data the
      // app itself just changed.
      staleTime: 30 * 1000,
      gcTime: CACHE_MAX_AGE,
      retry: 1,
      refetchOnReconnect: true,
      // Mutations already invalidate the exact queries they affect, so a focus
      // refetch only adds redundant network round-trips on top of staleTime.
      refetchOnWindowFocus: false,
    },
  },
});
