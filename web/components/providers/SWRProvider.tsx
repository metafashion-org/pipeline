"use client";

import { SWRConfig } from "swr";

// The client half of making view-switching quick. The server pages are cached under tags (see
// lib/dashboard/views.ts), but several views load their data from our own API after mount instead
// — the form builder, the board, the asset drawer — and each of those refetched from scratch every
// time its view was opened.
//
// SWR keeps its cache for as long as the tab is open, so with these defaults reopening a view
// paints the data it had immediately and revalidates behind that, rather than showing a spinner
// while the same request runs again.
export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        // Two mounts of the same key within a minute share one request. Leaving a view and coming
        // straight back is the case this covers.
        dedupingInterval: 60_000,
        // Alt-tabbing back to the dashboard is not a reason to refetch every open view. A window
        // that has been asleep is, which is what revalidateOnReconnect still covers.
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        // Show what we already have while the refetch runs, instead of dropping to undefined and
        // making every consumer render its loading state again.
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  );
}
