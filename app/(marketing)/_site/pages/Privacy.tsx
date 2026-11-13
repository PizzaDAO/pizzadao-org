"use client";

import LegalLayout, { LegalSection } from "@/app/(marketing)/_site/components/LegalLayout";

const sections: LegalSection[] = [
  {
    id: "overview",
    title: "Overview",
    body: (
      <>
        <p>
          PizzaDAO is a global community built around pizza, generosity, and
          the people who show up. This Privacy Policy explains what
          information we collect when you visit our websites, attend our
          events, or participate in our digital experiences - and what we do
          with it.
        </p>
        <p>
          We try to collect as little as possible, keep it for as short as
          possible, and never sell it. If something here is unclear, write to
          us and we'll do our best to plainly explain.
        </p>
      </>
    ),
  },
  {
    id: "information-we-collect",
    title: "Information we collect",
    body: (
      <>
        <p>
          Depending on how you interact with PizzaDAO, we may collect the
          following categories of information:
        </p>
        <ul className="list-disc space-y-2 pl-6 marker:text-tomato">
          <li>
            <strong className="text-ink">Contact details</strong> you give us
            voluntarily - for example, your email address when you sign up
            for the newsletter or RSVP to an event.
          </li>
          <li>
            <strong className="text-ink">Community identifiers</strong> such
            as your Discord, X, or wallet handle when you participate in
            community channels or governance.
          </li>
          <li>
            <strong className="text-ink">Event participation</strong>{" "}
            information when you attend a Global Pizza Party, a chapter
            meetup, or another PizzaDAO program.
          </li>
          <li>
            <strong className="text-ink">Basic device data</strong> - your
            IP, browser, and pages viewed - collected automatically by our
            hosting and analytics tools.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "how-we-use-it",
    title: "How we use it",
    body: (
      <>
        <p>We use information to:</p>
        <ul className="list-disc space-y-2 pl-6 marker:text-tomato">
          <li>Operate the website and our community programs.</li>
          <li>Send the things you asked for - newsletters, event invites, updates.</li>
          <li>Improve our content and understand which programs help most.</li>
          <li>Keep the community safe and enforce our code of conduct.</li>
          <li>Comply with legal obligations where applicable.</li>
        </ul>
        <p>
          We do not sell your information, and we do not use it to build
          advertising profiles about you.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and analytics",
    body: (
      <>
        <p>
          Our site uses a small number of cookies and similar technologies to
          remember preferences and understand aggregate traffic patterns. We
          aim to use privacy-respecting analytics that don't track you across
          other websites.
        </p>
        <p>
          We use <strong className="text-ink">PostHog</strong> as our product
          analytics tool to measure how the site is used in aggregate -
          which pages are visited, which calls to action are clicked, and
          where people get stuck. PostHog may also record a small sample of
          anonymised session replays so we can fix usability issues. All form
          inputs (name, email, message) are <em>masked</em> in those replays
          and never visible to us. We honour your browser's "Do Not Track"
          signal and run in a cookieless mode when it's set.
        </p>
        <p>
          You can disable cookies in your browser at any time. Some parts of
          the site may not function fully without them.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Sharing with third parties",
    body: (
      <>
        <p>
          We share information only with service providers who help us
          operate - for example, our email platform, our hosting provider, or
          event partners running a local pizza party with us. These providers
          are bound to use the information only for the purpose we asked.
        </p>
        <p>
          We may also disclose information when legally required, or to
          protect the safety of our community.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <p>
        We keep personal information only as long as we need it for the
        purpose it was collected, or as required by law. Newsletter
        subscribers can unsubscribe at any time via the link at the bottom of
        every email, and we remove their details from active sending lists
        promptly.
      </p>
    ),
  },
  {
    id: "sms-mms",
    title: "SMS & MMS communications",
    body: (
      <>
        <p>
          PizzaDAO operates the "Share Your Slice" messaging experience as
          part of Global Pizza Party and related community programs. You may
          voluntarily opt in to receive SMS/MMS communications from
          PizzaDAO by texting our publicly advertised phone number, or by
          voluntarily submitting pizza photos to that number via SMS/MMS.
        </p>
        <p>Messages you receive from us may include:</p>
        <ul className="list-disc space-y-2 pl-6 marker:text-tomato">
          <li>Submission confirmations.</li>
          <li>Moderation notifications about your submitted content.</li>
          <li>Participation-related updates.</li>
          <li>Livestream and community interaction notifications.</li>
          <li>Global Pizza Party related communications.</li>
        </ul>
        <p>
          Message frequency varies. Message and data rates may apply. You
          may reply <strong className="text-ink">STOP</strong> at any time
          to unsubscribe, or reply{" "}
          <strong className="text-ink">HELP</strong> for assistance.
        </p>
        <p>
          Your mobile information - including your phone number and the
          fact that you opted in - will not be shared with third parties or
          affiliates for marketing or promotional purposes. SMS consent is
          not transferred, sold, or shared with third parties. PizzaDAO only
          uses submitted phone numbers to operate the intended messaging
          experience described above and the related{" "}
          <a
            href="/terms"
            className="border-b border-ink/40 text-ink hover:border-tomato hover:text-tomato"
          >
            Terms of Use
          </a>
          .
        </p>
        <p>
          For SMS support or assistance, email{" "}
          <a
            href="mailto:hello@pizzadao.org"
            className="border-b border-ink/40 text-ink hover:border-tomato hover:text-tomato"
          >
            hello@pizzadao.org
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "your-rights",
    title: "Your rights",
    body: (
      <>
        <p>
          Depending on where you live, you may have the right to access,
          correct, export, or delete the personal information we hold about
          you, and to object to certain processing. To exercise any of these
          rights, email{" "}
          <a
            href="mailto:hello@pizzadao.org"
            className="border-b border-ink/40 text-ink hover:border-tomato hover:text-tomato"
          >
            hello@pizzadao.org
          </a>
          .
        </p>
        <p>
          We'll respond within a reasonable time and may ask you to verify
          your identity before acting on the request.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        PizzaDAO is not directed at children under 13, and we don't knowingly
        collect personal information from them. If you believe a child has
        provided us with information, contact us and we'll delete it.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        We may update this Privacy Policy from time to time as the project
        evolves. When we make material changes, we'll update the "Last
        updated" date above and, where appropriate, notify the community.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions or requests about this policy? Email{" "}
        <a
          href="mailto:hello@pizzadao.org"
          className="border-b border-ink/40 text-ink hover:border-tomato hover:text-tomato"
        >
          hello@pizzadao.org
        </a>{" "}
        or find us in the{" "}
        <a
          href="https://discord.pizzadao.xyz/"
          target="_blank"
          rel="noreferrer"
          className="border-b border-ink/40 text-ink hover:border-tomato hover:text-tomato"
        >
          PizzaDAO Discord
        </a>
        .
      </p>
    ),
  },
];

const Privacy = () => (
  <LegalLayout
    eyebrow="Legal"
    title="Privacy Policy"
    intro="How PizzaDAO handles information, communications, and community participation across our websites, events, and digital experiences."
    lastUpdated="May 17, 2026"
    sections={sections}
    metaTitle="Privacy Policy · PizzaDAO"
    metaDescription="How PizzaDAO collects, uses, and protects information across our websites, events, and community channels."
    canonical="https://pizzadao.org/privacy"
  />
);

export default Privacy;
