// Who may open and fill a given form.
//
// This was decided in four places with three different rules — the public page, the read route,
// the submit route, and the builder's own copy — all of them inferring "public" from an empty
// target_roles array. That inference is why a form built to create knowledge artifacts on submit
// ended up answerable by anyone with the URL. The audience is now a stated value on the row and
// this is the only thing that reads it.

import type { FormAudience } from "@/lib/db/schema/form_definitions";

export interface FormAudienceRow {
  audience: string;
  targetRoles: string[] | null;
  allowedEmails: string[] | null;
}

export interface FormViewer {
  email?: string | null;
  roles?: string[] | null;
  /** Present only for someone signed in as personnel. */
  personnelId?: string | null;
}

export type FormAccess =
  | { allowed: true }
  /**
   * `reason` is for the person, `status` for the response.
   * 401 means signing in would help; 403 means it would not.
   */
  | { allowed: false; status: 401 | 403; reason: string };

/** Whether this form is answerable without signing in at all. */
export function isPublicForm(form: FormAudienceRow): boolean {
  return normalizeAudience(form) === "public";
}

/**
 * Reads the audience off a row, tolerating rows written before the column existed.
 *
 * Input: the form's audience, roles and email list. Output: one of the three audiences.
 * A row whose audience column is missing or holds something unrecognised is read the way it was read before the column existed — roles if it has any, public otherwise — rather than being treated as an error at request time.
 */
export function normalizeAudience(form: FormAudienceRow): FormAudience {
  if (form.audience === "public" || form.audience === "roles" || form.audience === "emails") {
    return form.audience;
  }
  return form.targetRoles && form.targetRoles.length > 0 ? "roles" : "public";
}

/**
 * Decides whether this viewer may open and fill this form.
 *
 * Input: the form's audience settings and whoever is asking (possibly nobody). Output: allowed, or a refusal carrying both a status code and a sentence to show.
 *
 * An email-restricted form checks the address on the session, never one typed into the form. An address someone types about themselves is a claim, not proof, so accepting it would make the restriction decorative.
 */
export function checkFormAccess(form: FormAudienceRow, viewer: FormViewer | null): FormAccess {
  const audience = normalizeAudience(form);

  if (audience === "public") return { allowed: true };

  if (!viewer) {
    return { allowed: false, status: 401, reason: "Sign in to fill this form." };
  }

  if (audience === "roles") {
    const allowed = form.targetRoles || [];
    if (allowed.length === 0) {
      // A roles form with no roles is answerable by nobody. Saying so beats a bare 403 that looks
      // like the viewer's fault.
      return { allowed: false, status: 403, reason: "This form has no roles set, so nobody can fill it yet." };
    }
    // Lowercased on both sides: personnel.roles holds capitalised values in places.
    const held = new Set((viewer.roles || []).map((r) => r.toLowerCase()));
    if (allowed.some((r) => held.has(r.toLowerCase()))) return { allowed: true };
    return { allowed: false, status: 403, reason: "This form is for a different role." };
  }

  const list = (form.allowedEmails || []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) {
    return { allowed: false, status: 403, reason: "This form has no addresses on its list yet." };
  }
  const email = viewer.email?.trim().toLowerCase();
  if (email && list.includes(email)) return { allowed: true };
  return { allowed: false, status: 403, reason: "This form was shared with a specific list of addresses." };
}
