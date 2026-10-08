# Community navigation

Help visitors explore PizzaDAO and help members find their next action. Keep existing URLs and deep links.

## Navigation map

| Group | Destinations |
| --- | --- |
| Community | Crews (`/crews`), Members (`/crew`), Stories (`/articles`), Chats (`/chats`, members only) |
| Contribute | Missions (`/missions`), Earn & spend PEP (`/pep`), Projects (`/tech/projects`) |
| Resources | Guides (`/manuals`), Roles (`/turtles`), Call history (`/calls`), NFTs (`/nfts`), Event badges (`/poaps`), Print materials (`/print`), Support (`/support`) |

The account action remains Log in / Join for visitors and Dashboard for members. Shop administration remains permission gated.

## Implementation sequence

1. Add Community, Contribute, and Resources message keys in English, Spanish, and French. Use clear labels, while keeping recognizable terms such as PEP and POAP in descriptions.
2. Replace the flat desktop links and More dropdown with three accessible disclosure menus. Preserve active-route highlighting, including nested crew and article pages. Close on Escape, outside click, and navigation; restore focus to the opening button on Escape.
3. Present the same three groups in the mobile menu, with account actions first. Keep 44px tap targets and ensure longer translated labels wrap.
4. Add a visible Explore link on the welcome page leading to Crews. Expose Stories and Guides as secondary discovery paths, alongside Join and the single Discord DM login route.
5. Link Call history to the weekly crew schedule. Avoid suggesting that past attendance entries are upcoming meetings.
6. Verify visitor, member, and shop-admin states at desktop and mobile widths, with keyboard navigation and all supported languages. Check existing URLs and nested routes.

## Community evidence

Add a compact photo strip to the welcome page using approved existing community photos, with city and event captions. Pair it with three ways to participate: meet your local community, join a working crew, or contribute to a project. Show recent published stories beneath it. Add impact numbers only from an identified maintained source, with an “as of” date; omit them if they cannot be verified. Avoid a carousel that hides photos or requires interaction to understand the community.

## Shorter onboarding

Keep name, city, and Discord verification. Offer a typed display name as well as the generator. Move turtle roles and crew selection to dashboard actions, with an explicit “choose later” path. Auto-assign a member number server-side, atomically, with the existing custom-number option available on the city step. Preserve inviter attribution from invite links and make the manual inviter question optional after registration. Preserve the existing profile editing flow.

Implemented with a live roster read and a database advisory lock held through the existing sheet write. Discord identity comes from the authenticated cookie. Failed saves preserve the pending signup so members can retry.

## Explanations

- Mafia name: “Your display name in PizzaDAO. Use your own name or make a pizza-inspired one.”
- Turtles: “Our community roles, inspired by the Ninja Turtles. Choose the interests that fit you; you can change them later.”
- Crews: “Working groups that organize PizzaDAO projects and meet regularly. Join one when you’re ready to contribute.”
- Missions: “Guided tasks that help you get involved in PizzaDAO.”
- PEP: “PizzaDAO’s community points. See how to earn them and what you can spend them on.”
- POAPs: “Digital badges collected at community events.”

Place explanations alongside the relevant heading or first-use label, in each supported language. Preserve the playful headline and use plain supporting text.
