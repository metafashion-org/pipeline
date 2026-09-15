import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — MetaFashion Pipeline",
};

const EFFECTIVE_DATE = "September 15, 2026";
const CONTACT_EMAIL = "metafashionpipeline@gmail.com";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-16 space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-display font-semibold tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Effective {EFFECTIVE_DATE}</p>
        </header>

        <section className="space-y-2">
          <p>
            MetaFashion Pipeline (&ldquo;the Service&rdquo;) is the internal production-management tool for
            MetaFashion, a Roblox UGC fashion studio. This policy explains what data the Service
            collects, why, and how it is used.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">1. Data we collect</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Google account data.</strong> Signing in uses Google OAuth. We receive your
              name, email address, and Google account ID. We do not receive your Google password.
            </li>
            <li>
              <strong>Personnel data.</strong> For people granted access, we store role, active
              status, and, where linked, Discord user and channel IDs.
            </li>
            <li>
              <strong>Form submissions.</strong> The public artist-access form and other intake
              forms collect the fields shown on each form, such as name, contact details, and
              portfolio links.
            </li>
            <li>
              <strong>Work and payment records.</strong> For assigned work, we store asset status
              history, fee and currency, and payment cycle records tied to your personnel record.
            </li>
            <li>
              <strong>Session cookies.</strong> A cookie set by NextAuth keeps you signed in. We do
              not use advertising or tracking cookies.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">2. How we use it</h2>
          <p>
            Data is used to operate the pipeline: authenticating you, granting access based on
            your role, assigning and tracking asset work, communicating through Discord and email,
            and running payment cycles. We do not sell data and do not share it with advertisers.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">3. Who can see it</h2>
          <p>
            Personnel and work data are visible to MetaFashion staff whose role requires it, as
            enforced by the Service&apos;s own access controls. Data is also processed by the
            infrastructure providers that run the Service: Google (sign-in), Discord (team
            communication), Supabase (database hosting), and Vercel (application hosting).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">4. Retention</h2>
          <p>
            We keep personnel and asset records for as long as they are needed for the pipeline and
            its payment and audit history. You can ask us to review or delete data tied to you
            using the contact below; some records may be kept where needed for payment or audit
            records.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">5. Security</h2>
          <p>
            Access to the Service is restricted to personnel with an active account, and every
            action is checked against that person&apos;s role and status on each request. Data is
            stored in a hosted Postgres database and transmitted over HTTPS.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">6. Changes</h2>
          <p>
            If this policy changes, the effective date above will be updated. Continued use of the
            Service after a change means you accept the revised policy.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">7. Contact</h2>
          <p>
            Questions about this policy or your data go to{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>

        <footer className="pt-6 border-t border-border text-sm text-muted-foreground">
          <Link className="underline" href="/tos">
            Terms of Service
          </Link>
        </footer>
      </div>
    </div>
  );
}
