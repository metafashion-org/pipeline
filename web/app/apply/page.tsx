import { redirect } from "next/navigation";
import { seedOnboardingFormDefinition, ARTIST_ACCESS_FORM_KEY } from "@/lib/forms/onboarding";

export const dynamic = "force-dynamic";

// /apply is the friendly URL for the Artist Access Request form, and it is linked from the admin
// Personnel page. It used to carry its own copy of the public form page; now that every public
// form is served from /f/<key>, this is just the nicer name for one of them, so it redirects
// rather than keeping a second implementation of the same screen in sync.
export default async function ApplyPage() {
  // Seeded here as before, so the target exists on a first-ever visit rather than 404ing.
  await seedOnboardingFormDefinition();
  redirect(`/forms/${ARTIST_ACCESS_FORM_KEY}`);
}
