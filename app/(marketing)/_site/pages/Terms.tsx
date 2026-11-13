"use client";

import LegalLayout, { LegalSection } from "@/app/(marketing)/_site/components/LegalLayout";

const sections: LegalSection[] = [
  {
    id: "agreement",
    title: "The agreement",
    body: (
      <>
        <p>
          These Terms govern your use of pizzadao.org, our community
          channels, and the programs we organize (collectively, the
          "Services"). By using the Services you agree to these Terms. If you
          don't agree, please don't use them.
        </p>
        <p>
          PizzaDAO is a community-driven project. Parts of the Services are
          operated by volunteers and collaborators around the world. We try
          to be clear about who runs what, and these Terms apply to all of
          it.
        </p>
      </>
    ),
  },
  {
    id: "who-can-use",
    title: "Who can use PizzaDAO",
    body: (
      <p>
        You may use the Services if you can form a binding contract with us
        and doing so doesn't violate any laws that apply to you. If you're
        using the Services on behalf of an organization, you confirm that you
        have authority to bind that organization to these Terms.
      </p>
    ),
  },
  {
    id: "community-conduct",
    title: "Community conduct",
    body: (
      <>
        <p>
          PizzaDAO is built on showing up for each other. To keep the
          community healthy, please don't:
        </p>
        <ul className="list-disc space-y-2 pl-6 marker:text-tomato">
          <li>Harass, threaten, or discriminate against anyone.</li>
          <li>Impersonate PizzaDAO or its contributors.</li>
          <li>Post illegal, deceptive, or harmful content.</li>
          <li>Use the Services to send spam or run scams.</li>
          <li>Interfere with the Services or try to circumvent security.</li>
        </ul>
        <p>
          We may remove content, suspend accounts, or restrict access to
          enforce these expectations. Repeated or severe violations can lead
          to a permanent ban.
        </p>
      </>
    ),
  },
  {
    id: "your-content",
    title: "Your content",
    body: (
      <>
        <p>
          You keep ownership of the content you post - photos from a pizza
          party, comments in the forum, posts in Discord, contributions to
          the journal. By posting it through our Services, you grant
          PizzaDAO a non-exclusive, worldwide, royalty-free license to host,
          display, and share that content in connection with running the
          community and telling its story.
        </p>
        <p>
          You're responsible for what you post and confirm you have the
          rights to share it.
        </p>
      </>
    ),
  },
  {
    id: "intellectual-property",
    title: "Our intellectual property",
    body: (
      <p>
        The PizzaDAO name, logos, brand system, written content, and
        site design are protected by intellectual property laws and remain
        the property of PizzaDAO and its contributors. You may reference us
        in good-faith editorial coverage. For other uses - partnerships,
        merch, redistribution - please see our brand system or write to us
        first.
      </p>
    ),
  },
  {
    id: "events",
    title: "Events and programs",
    body: (
      <>
        <p>
          PizzaDAO programs - Global Pizza Party, community grants, field
          reports, residencies - may have their own rules in addition to
          these Terms. Where there's a conflict, the program-specific rules
          control for that program.
        </p>
        <p>
          Local chapter events are organized by community members. PizzaDAO
          isn't liable for the conduct of individual organizers, attendees,
          or venues, though we expect everyone to follow our community
          conduct expectations above.
        </p>
      </>
    ),
  },
  {
    id: "sms-mms",
    title: "SMS & MMS terms",
    body: (
      <>
        <p>
          The "Share Your Slice" messaging experience lets you participate
          in Global Pizza Party and related PizzaDAO programs by text
          message. Participation is entirely voluntary. By texting the
          publicly advertised PizzaDAO phone number, you consent to receive
          automated SMS/MMS communications from PizzaDAO related to your
          participation, as further described in our{" "}
          <a
            href="/privacy"
            className="border-b border-ink/40 text-ink hover:border-tomato hover:text-tomato"
          >
            Privacy Policy
          </a>
          .
        </p>
        <p>
          Pizza photos, captions, usernames, city names, and related content
          you submit by SMS/MMS may appear in:
        </p>
        <ul className="list-disc space-y-2 pl-6 marker:text-tomato">
          <li>Livestreams and livestream overlays.</li>
          <li>Moderation dashboards used by PizzaDAO contributors.</li>
          <li>Community galleries on PizzaDAO surfaces.</li>
          <li>PizzaDAO social content.</li>
          <li>Global Pizza Party experiences, online and in person.</li>
        </ul>
        <p>
          You retain ownership of the content you submit. By submitting it,
          you grant PizzaDAO a non-exclusive, worldwide, royalty-free right
          to display, reproduce, and distribute that content in connection
          with Global Pizza Party and PizzaDAO community experiences.
        </p>
        <p>
          PizzaDAO reserves the right to moderate, reject, or remove any
          submission at its discretion. Submissions containing illegal,
          hateful, abusive, explicit, spam, fraudulent, or non-pizza-related
          content may be rejected or removed, and repeated violations may
          result in the sender being blocked from the experience.
        </p>
        <p>
          Message frequency varies. Message and data rates may apply. Reply{" "}
          <strong className="text-ink">STOP</strong> at any time to
          unsubscribe, or reply <strong className="text-ink">HELP</strong>{" "}
          for assistance. For support, email{" "}
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
    id: "third-party",
    title: "Third-party links and tools",
    body: (
      <p>
        Our Services link to third-party sites and integrate with
        third-party tools - Discord, social networks, wallets, video
        platforms, and others. We don't control those services and aren't
        responsible for their content or practices. Your use of them is
        governed by their own terms.
      </p>
    ),
  },
  {
    id: "no-financial-advice",
    title: "No financial advice",
    body: (
      <p>
        Nothing on this site or in our community channels is financial,
        legal, or tax advice. Conversations about tokens, wallets, or
        governance are educational and reflect community perspectives - they
        are not recommendations. Do your own research and consult qualified
        professionals where appropriate.
      </p>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p>
        The Services are provided on an "as is" and "as available" basis. To
        the fullest extent permitted by law, PizzaDAO disclaims all
        warranties, express or implied, including warranties of
        merchantability, fitness for a particular purpose, and
        non-infringement.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <p>
        To the maximum extent permitted by law, PizzaDAO and its
        contributors won't be liable for any indirect, incidental, special,
        consequential, or punitive damages arising out of or related to your
        use of the Services. Our total liability for any direct damages will
        not exceed one hundred U.S. dollars (USD 100) or the amount you paid
        us in the prior twelve months, whichever is greater.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        We may update these Terms from time to time. When we make material
        changes, we'll update the "Last updated" date above and, where
        appropriate, notify the community. Continued use of the Services
        after changes take effect means you accept the updated Terms.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions about these Terms? Email{" "}
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

const Terms = () => (
  <LegalLayout
    eyebrow="Legal"
    title="Terms of Use"
    intro="The ground rules for using pizzadao.org, our community channels, and the programs we organize together."
    lastUpdated="May 17, 2026"
    sections={sections}
    metaTitle="Terms of Use · PizzaDAO"
    metaDescription="The terms that govern your use of pizzadao.org, our community channels, and the programs we organize together."
    canonical="https://pizzadao.org/terms"
  />
);

export default Terms;
