# Tasks

Stages: todo · doing · stuck · review · done · skip — Priority: P1 (highest) … P4
Imported from the project Google Sheet on 2026-10-04; this file is now the source of truth.

## Open

| ID | Task | Stage | Priority | Due | Lead | Tags | Plan | PR | Notes |
|----|------|-------|----------|-----|------|------|------|----|-------|
| calzone-30418 | Recorder bot joins community calls, records, transcribes, summarizes, and posts them on the website | doing | P2 |  |  |  | plans/calzone-call-recorder.md | #174 | Phase 0+1 merged (#174). Next: Snax sets up R2 + Railway + Vercel env, test on a real call, then Phase 2 (transcripts/summaries, public pages) |
| tax-form-redirect | Redirect app.pizzadao.org/tax-form to rsv.pizza/tax-form (keeps ?payee= token) for Rare Pizzas W-9/W-8 requests | review | P2 |  | Snax | tax |  |  |  |
| parmesan-10386 | Deliver POAPs automatically to people on the discord channel attendance | doing | P3 |  |  |  | plans/parmesan-10386.md |  |  |
| jalapeno-34126 | Add animation/pop up to signal your profile has been completed | todo | P2 |  | Pizza Lord |  |  |  |  |
| pizzaiolo-13628 | update timezone for crewsheet | todo | P2 |  |  |  |  |  | when someone selects their city, the timezone should auto format to their local pov |
| garlic-67660 | page of Print Materials to make it easy for members to print stickers etc | todo | P2 |  |  |  |  |  |  |
| marinara-32633 | generated nametags for rsvp'd members | todo | P2 |  |  |  |  |  |  |
| calzone-93434 | Add Telegram login | todo | P2 |  |  |  | plans/calzone-93434-telegram-login.md |  |  |
| mozzarella-67760 | Add Language Preference to the dashboard | todo | P2 |  |  |  |  |  |  |
| bellpepper-80127 | Idea para dashboard: carpeta para subir memes de pizzadao y bennys xD | todo | P2 |  |  |  |  |  |  |
| pineapple-84122 | Auto-Invite member to event or one is near their city | todo | P2 |  |  |  | plans/pineapple-84122-nearby-event-invites.md |  |  |
| pineapple-71302 | add a email claiming system for memebes to claim a unique pizzadao emails | todo | P3 |  |  |  | plans/pineapple-71302-pizzadao-emails.md |  | 2026-10-17: on hold, not yet (Snax) |
| buffalo-96244 | Support ticket function | todo | P3 |  |  |  |  |  |  |

## Done

| ID | Task | Priority | Done | PR | Notes |
|----|------|----------|------|----|-------|
| oregano-41907 | Welcome new Pizza Trainees by DM + welcome channel: "Welcome to PizzaDAO! Grab a name at https://app.pizzadao.org" | P2 | 2026-10-18 | #173 | Gated by TRAINEE_NICK_ENABLED; optional TRAINEE_WELCOME_CHANNEL_ID |
| blackolive-55617 | Mafia Spotlight Submission form | P2 | 2026-10-18 | #169 | Needs a "Mafia Spotlight" row in the webhooks sheet |
| jalapeno-82565 | Custom Crew Bounties 🏴‍☠️ | P2 | 2026-10-18 | #172 |  |
| artichoke-67361 | it should truncate non alphanumeric characters from names on signup | P3 | 2026-10-18 | #171 |  |
| woodfired-65373 | Check box mafia role and suggest buying a box | P3 | 2026-10-18 | #170 |  |
| zucchini-21674 | if the user's already in pizzadao's discord, don't ask for permission to join servers for them | P3 | 2026-10-18 | #168 |  |
| anchovy-52918 | Bot names new Discord joiners "Pizza Trainee" unless they've signed up on app.pizzadao.org | P2 | 2026-10-18 | #166 | Ships disabled; enable with TRAINEE_NICK_SINCE + TRAINEE_NICK_ENABLED |
| napoletana-52080 | pizza noob role logic | P3 | 2026-10-18 |  | Covered by anchovy-52918 (Pizza Noob role for trainees; removed on Level 2 completion) |
| olive-40696 | add region role setting to onboarding flow | P1 |  |  |  |
| diavola-24729 | Fix pep jobs so they don't have ugly discord names etc | P2 |  |  |  |
| pizzaiolo-47022 | prompt the signing up user to join their nearest city's telegram group | P2 |  |  |  |
| stromboli-34263 | prettify writes to crew sheet: biz_dev, comms, creative | P2 |  |  |  |
| neapolitan-96018 | Crew page with start crew call button | P2 |  |  |  |
| artichoke-49514 | Integrate Missions Channel to the profile dashboard to track member progress easier. | P3 |  |  | when somebody completes a mission, it should update a sheet so we can track and send pepperoni for completing missions |
