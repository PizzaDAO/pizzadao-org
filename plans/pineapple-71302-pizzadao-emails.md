# pineapple-71302: Members claim a unique @pizzadao.org email

Status: design only, decisions needed. No code in this PR.

## Goal

A member in good standing can claim `handle@pizzadao.org` from their profile. Mail to that address reaches them.
Optionally, they can send as it. The address is released when they leave or abuse it.

## Current state (checked 2026-10-02 with `dig`)

| Record | Value | Implication |
|---|---|---|
| NS | `dns1/dns2.registrar-servers.com` | DNS is Namecheap BasicDNS. Changes go through `~/Code/namecheap/add-dns-record.py`, never by hand. |
| MX | `1 smtp.google.com.` | **pizzadao.org already receives mail through Google Workspace.** Any other inbound provider on the apex would take over existing Workspace mailboxes. |
| TXT (apex) | only `google-site-verification=...` | **No SPF record.** Mail sent "from" @pizzadao.org is easy to spoof today. This should be fixed regardless of this feature. |
| `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarcreports@lovable.dev` | DMARC reports go to a third party (lovable.dev), which looks like a leftover from a site builder. Worth fixing too. |

Because the apex MX already belongs to Workspace, apex forwarding services (Cloudflare Email Routing, ImprovMX on
`@pizzadao.org`) are **not drop-in**. Either route through Workspace, or use a subdomain.

## Options

### A. Google Groups in the existing Workspace as forwarders (recommended for v1)

Each claimed address is a Workspace **Google Group** (`tony@pizzadao.org`) with one external member (the
member's personal email), "anyone can post" enabled, and archive disabled.

- **Cost:** $0 extra. Groups don't consume seats.
- **Inbound:** yes, with Google's spam filtering. **Outbound "send as":** no. Replies come from the personal
  address. (Gmail "Send mail as" needs SMTP, which a group doesn't have.)
- **Automation:** Admin SDK Directory API (`groups.insert`, `members.insert`) through a service account with
  domain-wide delegation. The repo already uses a Google service account (`app/lib/google-auth.ts`), so it needs
  a new scope (`admin.directory.group`) and an admin to grant delegation.
- **Limits:** Workspace caps group creation per day and the number of external recipients. Fine for our scale
  (tens to low hundreds of claims). Verify the current quotas.
- **Risk:** inbound-only forwarding of spam to members. Mitigate with Google's spam filter plus moderation
  settings.

### B. Google Workspace seats (full mailboxes)

- **Cost:** Business Starter is about $7/user/month on an annual plan (about $8.40 flexible; verify current
  list price). 100 members is about $8.4k/year. Google for Nonprofits is free or discounted, but only if
  PizzaDAO has an eligible registered nonprofit entity.
- **Pros:** real mailbox, send-as, Drive/Calendar, SSO ("Sign in with Google" as @pizzadao.org).
- **Cons:** cost scales per member, seats need offboarding, and a larger admin/security surface (2FA
  enforcement, data retention). Best kept for **core contributors and crew leads only**.

### C. Subdomain forwarding: `handle@members.pizzadao.org` via ImprovMX or Forward Email

Leave the apex on Workspace and point `members.pizzadao.org` MX at a forwarding provider.

- **ImprovMX:** free tier is 1 domain and 25 aliases. Paid (about $9/month and up) raises alias limits and
  adds SMTP sending, so members can "send as" from Gmail. It has an API for alias CRUD.
- **Forward Email:** open source, about $3/month for unlimited aliases plus SMTP/IMAP, and an API.
- **Cloudflare Email Routing** is free, but only works when the zone's nameservers are Cloudflare. A subdomain
  can't be delegated on the free plan, so it doesn't fit while DNS stays on Namecheap. It also has no
  outbound sending and caps routing rules per zone.
- **Pros:** cheap, API-driven, isolated from staff mail. **Cons:** a longer address. Members asked for
  `@pizzadao.org`.

### D. Workspace "recipient address map" (Gmail routing) on one catch-all seat

One paid seat (`members@`) plus an admin-console routing rule that rewrites `handle@pizzadao.org` to an external
address. It's cheap, but the address map is edited in the admin console or by CSV upload, with no clean API.
That makes it hard to automate. **Not recommended.**

### E. Self-hosted or other providers (Migadu, Zoho Mail Lite at about $1/user/month)

These would replace Workspace on the apex, which means migrating existing staff mail. **Not recommended** unless
Workspace is being dropped anyway.

## Recommended path

1. **v1: Option A** (Groups as forwarders) on the apex. Free, uses existing infra, `@pizzadao.org`.
2. **Send-as later:** offer a paid seat (B) to crew leads, or move to Option C with SMTP if many members want
   to send.
3. **Fix SPF and DMARC first:** add `v=spf1 include:_spf.google.com ~all`, set up DKIM in the Workspace admin
   console, and point DMARC `rua` at a PizzaDAO-owned inbox. Move to `p=quarantine` once reports are clean.

## Product flow (v1)

- `/profile/[id]/edit` gets a "Claim your @pizzadao.org email" section, visible when the member meets the
  eligibility rule.
- Form: desired handle (default: slug of mafia name) and forwarding address. Send a **verification email to
  the forwarding address** (signed link, 24h TTL) before creating the group. This proves ownership and stops
  people forwarding to someone else.
- New model `PizzaEmail { id, discordId @unique, memberId, handle @unique, forwardTo, status
  (PENDING_VERIFY|ACTIVE|SUSPENDED|RELEASED), verifiedAt, createdAt, releasedAt, googleGroupId }`.
- Admin page `/admin/emails`: list, suspend, release, and a reserved-handle list.
- Cron (daily): release or suspend addresses whose owners left the guild or lost the eligibility role.

## Abuse controls

- **Eligibility:** for example, member for 30+ days **and** at least one vouch, or a specific Discord role.
  Decision needed.
- **One address per member.** Handle changes are rate-limited (for example, once per 90 days). Released handles
  are quarantined for 90 days before anyone can reuse them, so mail meant for the previous owner doesn't leak.
- **Reserved handles:** `admin, support, security, abuse, postmaster, hostmaster, webmaster, info, team, dao,
  treasury, legal, press, billing, noreply, root, hello, contact`, all existing staff mailboxes and groups, and
  crew names. Reject impersonation patterns (for example `*-official`, `*support*`) and run a profanity filter.
- **Handle format:** `^[a-z0-9](?:[a-z0-9.-]{1,28}[a-z0-9])$`, no consecutive dots.
- **Inbound-only in v1:** nobody can *send* as @pizzadao.org, which removes most phishing risk. With SPF/DKIM/
  DMARC fixed, spoofing gets hard too.
- **Kill switch:** admins can suspend instantly (remove the group member), and there's a published
  `abuse@pizzadao.org` contact.
- **Audit log** of claims, changes and suspensions.
- **Terms:** a short acceptable-use note shown at claim time (no impersonating PizzaDAO staff, and no using
  the address for financial solicitations on PizzaDAO's behalf).

## Costs summary

| Option | Up-front | Ongoing (100 members) | Send-as |
|---|---|---|---|
| A. Workspace Groups | admin setup | $0 | No |
| B. Workspace seats | admin setup | about $8.4k/yr | Yes |
| C. ImprovMX / Forward Email subdomain | DNS records | about $36–$110/yr | Yes (paid tiers) |
| D. Address map | manual | 1 seat (about $84/yr) | No |

Prices are approximate list prices. Verify them before deciding.

## Decisions needed

1. Must it be `@pizzadao.org` (A/B/D) or is `@members.pizzadao.org` acceptable (C)?
2. Is inbound forwarding enough for v1, or is send-as required?
3. Who is eligible (tenure, vouches, role)?
4. Who administers the Workspace, and will they grant domain-wide delegation for `admin.directory.group` to
   the app's service account?
5. Does PizzaDAO have a nonprofit entity that qualifies for Google for Nonprofits (it changes option B's cost)?
6. Approve fixing SPF, DKIM and DMARC first (recommended; independent of this feature).
7. Offboarding policy: release on leaving the guild, or after N months of inactivity?
