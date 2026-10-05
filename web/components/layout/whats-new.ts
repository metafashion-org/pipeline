// Sidebar pages that are new or changed, marked "New" for about two weeks after they ship. The
// "i" beside the mark says why the page was added and what it's for. An entry past its newUntil
// day shows nothing and can be deleted.

export interface WhatsNewEntry {
  /** The sidebar item's href. */
  href: string;
  /** The last day (India time, "YYYY-MM-DD") the mark shows. */
  newUntil: string;
  why: string;
  whatFor: string;
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    href: "/admin/signoff",
    newUntil: "2026-10-20",
    why: "It replaces the Curation form. New assets used to go straight on the board; now Arjun signs each one off first.",
    whatFor:
      "Assets added with New Asset wait here. Arjun approves them onto the board, sends them back with feedback, or drops them. If one of yours is sent back, fix it and resubmit it here.",
  },
  {
    href: "/artist/profile",
    newUntil: "2026-10-20",
    why: "It replaces the Team Onboarding Google Form, which never asked for a bank account number or IFSC.",
    whatFor:
      "Add your UPI ID, bank account, IFSC, PAN, your Aadhaar, PAN and cheque images, and your signed NDA once. This is what we pay you on. A later change needs a reason and our approval.",
  },
  {
    href: "/admin/artist-details",
    newUntil: "2026-10-20",
    why: "So we have every artist's bank and UPI details in one place before each payment on the 15th and 30th.",
    whatFor:
      "See who has filled in their details, open an artist's full details (each view is logged), approve or decline changes, and remind the artists who haven't filled it in.",
  },
  {
    href: "/team",
    newUntil: "2026-10-15",
    why: "So everyone can see what each person on the full-time team is working on today and what's next, without chasing updates.",
    whatFor:
      "Every task has one owner. Pick your tasks for the day at the top of your column, tick off subtasks, and link the insight or SKU a task came from. Everyone gets a summary at 7 pm by email and on Discord.",
  },
  {
    href: "/admin/calendar",
    newUntil: "2026-10-15",
    why: "So the whole company sees what is going live when.",
    whatFor:
      "One month view of each asset's artist deadline, the day we plan to upload it, and the day it went live. Click an entry to open the asset on the board.",
  },
  {
    href: "/artist/submit",
    newUntil: "2026-10-14",
    why: "It replaces the 3D Art Submission Google Form.",
    whatFor: "Pick your approved asset and upload one .zip. It goes straight to the team Drive, and the card moves to Ready for Upload by itself.",
  },
  {
    href: "/admin/knowledge",
    newUntil: "2026-10-15",
    why: "The New Artifact form asked every type for the same eight fields.",
    whatFor:
      "Pick a type first and fill in only what it needs: an insight with its proof and images, a prompt with its chat and input files, a recolor kit as a Drive folder.",
  },
];

/**
 * The "New" entry for a sidebar item, while it is still new.
 *
 * Input: the item's href and today's day ("YYYY-MM-DD", India time). Output: the entry, or null.
 */
export function whatsNewFor(href: string, today: string): WhatsNewEntry | null {
  return WHATS_NEW.find((entry) => entry.href === href && today <= entry.newUntil) ?? null;
}
