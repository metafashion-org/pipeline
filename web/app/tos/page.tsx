import Link from "next/link";

export const metadata = {
  title: "Terms of Service — MetaFashion Pipeline",
};

const EFFECTIVE_DATE = "September 15, 2026";
const CONTACT_EMAIL = "metafashionpipeline@gmail.com";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-16 space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-display font-semibold tracking-tight">Terms of Service</h1>
          <p className="text-sm text-muted-foreground">Effective {EFFECTIVE_DATE}</p>
        </header>

        <section className="space-y-2">
          <p>
            These terms govern use of MetaFashion Pipeline (&ldquo;the Service&rdquo;), the production-
            management tool for MetaFashion, a Roblox UGC fashion studio. By signing in or
            submitting a form through the Service, you agree to these terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">1. Access</h2>
          <p>
            Sign-in is by Google account. Signing in only creates a session; what you can open
            depends on the role and status on your personnel record. Access is granted at
            MetaFashion&apos;s discretion and can be revoked at any time, including by setting your
            status to inactive.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">2. Acceptable use</h2>
          <p>
            The Service is for MetaFashion production work only. You agree not to share your
            account access with anyone else, not to submit false information on any form, and not
            to attempt to access data or actions your role does not permit.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">3. Submitted work</h2>
          <p>
            Assets, artwork, and other deliverables submitted through the Service are governed by
            the separate artist or contributor agreement between you and MetaFashion, not by these
            terms. These terms cover only your use of the Service itself.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">4. Payments</h2>
          <p>
            Fees, currency, and payment cycle records shown in the Service reflect MetaFashion&apos;s
            internal payment tracking and do not by themselves constitute a payment or a promise of
            payment. Any dispute over a payment is resolved under your separate agreement with
            MetaFashion.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">5. Availability</h2>
          <p>
            The Service is provided &ldquo;as is,&rdquo; without warranty of any kind, and may be unavailable
            or changed at any time. MetaFashion is not liable for lost work or delays caused by
            Service downtime.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">6. Termination</h2>
          <p>
            MetaFashion may suspend or end your access at any time, including by removing or
            marking your personnel record inactive. Sections 3 and 4 survive termination.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">7. Governing law</h2>
          <p>These terms are governed by the laws of India.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">8. Changes</h2>
          <p>
            If these terms change, the effective date above will be updated. Continued use of the
            Service after a change means you accept the revised terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">9. Contact</h2>
          <p>
            Questions about these terms go to{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>

        <footer className="pt-6 border-t border-border text-sm text-muted-foreground">
          <Link className="underline" href="/privacy">
            Privacy Policy
          </Link>
        </footer>
      </div>
    </div>
  );
}
