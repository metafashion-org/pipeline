import type { ReactNode } from "react";

/**
 * The header every page inside the shell uses.
 *
 * Input: the page title, an optional one-line description, and optional controls for the right-hand side. Output: a header bar that does not scroll with the page body.
 *
 * Each page previously built its own, and they had drifted: some had a back arrow to /admin, some
 * did not; every one repeated the theme toggle and the sign-out button, which now live once in
 * the sidebar; titles were set at three different sizes; and the description was hidden below the
 * `sm` breakpoint on some pages and not others, so on a phone half the pages lost the only line
 * saying what they were for.
 *
 * The left padding steps in below `md` to clear the menu button the sidebar puts in that corner.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="shrink-0 border-b border-border bg-card">
      <div className="flex items-start justify-between gap-4 px-4 sm:px-6 py-3 pl-16 md:pl-6">
        <div className="min-w-0">
          <h1 className="text-xl truncate">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * The scrolling body beneath a PageHeader.
 *
 * Input: the page content and an optional class for pages that manage their own scrolling, such as the board. Output: a padded, scrollable region that fills the rest of the shell.
 */
export function PageBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`flex-1 overflow-auto p-4 sm:p-6 ${className}`}>{children}</main>;
}
