// app/lib/newsletter/test-send.ts
//
// Test send of an issue to the signed-in admin's OWN verified email address, nowhere else. Uses the
// existing mailer and the newsletter sender settings, and respects the switches: no sender address,
// confirmation emails switched off, or a missing Resend key means no test mail.
import { prisma } from "@/app/lib/db";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { postalAddress, sendEmail, type SendResult } from "@/app/lib/reengage/mailer";
import { loadSettings } from "@/app/lib/settings";
import { resolveToggle } from "@/app/lib/settings/toggles";
import { renderNewsletter } from "./render";
import { newsletterSender } from "./sender";
import { sectionsSchema } from "./sections";
import { IssueError } from "./issue";

export const TEST_SENDS_PER_HOUR = 10;

export type TestSendOutcome = { ok: true } | { ok: false; status: number; error: string };

export async function sendTestIssue(issueId: string, adminDiscordId: string): Promise<TestSendOutcome> {
  const settings = await loadSettings();
  const sender = newsletterSender(settings);
  if (!sender) return { ok: false, status: 409, error: "No newsletter sender address is configured (Settings, Newsletter)." };
  if (!resolveToggle("newsletter.confirmEmailsEnabled", settings)) {
    return { ok: false, status: 409, error: "Newsletter email is switched off (Settings, Newsletter: Send newsletter confirmation emails)." };
  }
  if (!process.env.RESEND_API_KEY?.trim()) return { ok: false, status: 409, error: "Email sending is not configured on this deployment." };

  const issue = await prisma.newsletterIssue.findUnique({ where: { id: issueId } });
  if (!issue) throw new IssueError(404, "Issue not found");
  const parsed = sectionsSchema.safeParse(issue.sections);
  if (!parsed.success) return { ok: false, status: 409, error: "The content is not valid." };

  const memberId = await fetchMemberIdByDiscordId(adminDiscordId).catch(() => null);
  const extras = memberId ? await prisma.memberProfileExtras.findUnique({ where: { memberId }, select: { email: true, emailVerifiedAt: true } }) : null;
  if (!extras?.email || !extras.emailVerifiedAt) {
    return { ok: false, status: 400, error: "Verify your own email address in your email preferences first; test sends go only there." };
  }

  const since = new Date(Date.now() - 3_600_000);
  const recent = await prisma.newsletterIssueEvent.count({ where: { issueId, action: "test-send", createdAt: { gte: since } } });
  if (recent >= TEST_SENDS_PER_HOUR) return { ok: false, status: 429, error: "Too many test sends this hour." };

  const mail = renderNewsletter(
    { subject: issue.subject, preheader: issue.preheader, sections: parsed.data },
    { postalAddress: postalAddress(), testBanner: "Test send. This is a draft preview, not the real issue." },
  );
  const res: SendResult = await sendEmail({
    to: extras.email,
    subject: `[Test] ${mail.subject}`,
    html: mail.html,
    text: mail.text,
    from: sender.from,
    replyTo: sender.replyTo,
  });
  // The audit row has no address and no content.
  await prisma.newsletterIssueEvent.create({ data: { issueId, action: "test-send", actor: adminDiscordId, data: { ok: res.ok, ...(res.ok ? {} : { reason: res.reason }) } } });
  return res.ok ? { ok: true } : { ok: false, status: 502, error: "The email provider didn't accept the test message." };
}
