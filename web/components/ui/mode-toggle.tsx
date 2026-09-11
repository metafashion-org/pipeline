"use client";

import * as React from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";

const MODES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/**
 * Cycles light, dark and system.
 *
 * It was a dropdown with three items, sitting in the header of every page — three clicks and a
 * menu to change one setting that has three states, repeated a dozen times across the app. There
 * is one of these now, in the sidebar footer, and it advances on click. The icon shows the mode
 * that is set, not the one the click would produce, so the control reports state rather than
 * predicting the next one.
 *
 * `theme` is undefined until next-themes has read the stored preference after mount, so the icon
 * renders as a fixed placeholder until then rather than flipping on hydration.
 */
export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const index = MODES.findIndex((m) => m.value === theme);
  const current = mounted && index >= 0 ? MODES[index] : MODES[1];
  const Icon = current.Icon;

  return (
    <button
      type="button"
      onClick={() => setTheme(MODES[(index + 1 + MODES.length) % MODES.length].value)}
      title={`Theme: ${current.label}. Click to change.`}
      aria-label={`Theme: ${current.label}. Click to change.`}
      className="h-9 w-9 shrink-0 grid place-items-center rounded-md text-sidebar-foreground hover:text-white hover:bg-sidebar-accent transition-colors"
    >
      <Icon className="w-[18px] h-[18px]" />
    </button>
  );
}
