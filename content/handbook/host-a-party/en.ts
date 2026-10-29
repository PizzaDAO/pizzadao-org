export const title = 'Host a party'
export const dek = 'How to throw a PizzaDAO pizza party: plan it, budget it, announce it, run it and get reimbursed.'
export const reviewed = '2026-10'

export const body = String.raw`
Anyone can host a PizzaDAO party: a few friends, a pizzeria, a community space. This page covers the whole journey. If you are new, read [getting started](/handbook/getting-started) first and join a call of the events crew.

## Before you start {#before}

1. **Pick a venue and a date.** A pizzeria, a bar with a kitchen, a coworking space or a park all work. Choose somewhere with an oven nearby or a delivery option.
2. **Find co-hosts.** Hosting with one or two other people shares the work. A local pizzeria is a great partner.
3. **Tell the events crew.** Say what city you are in and when. They can connect you with other hosts and answer questions.
4. **Make a page for guests.** Create an event page on rsv.pizza so people can RSVP, and so the party counts toward the missions that ask for one.
5. **List it.** Add your party to the community events list so people nearby can find it.

::if eventsUrl
You can list your party on the [events site]({{eventsUrl}}).
::end

::if hostPlaybookUrl
There is also a longer [host playbook]({{hostPlaybookUrl}}) with extra tips.
::end

## Budget {#budget}

Plan a simple budget before you spend anything: pizza, drinks, a venue fee if there is one, and any printing. Copy the budget template, fill it in and share it with the events crew for approval. Spending that was not approved first may not be reimbursed.

::if hostCapUsd
The DAO can contribute up to {{hostCapUsd}} toward a hosted party.
::end

::if budgetTemplateUrl
[Open the budget template]({{budgetTemplateUrl}}) and make your own copy.
::end

Pizzerias often sponsor part of a party. If one does, say so in your budget so the DAO's contribution can be smaller.

## Pizza math {#pizza-math}

Do not order everything at once. Order in waves, about every 45 minutes, so the pizza arrives hot. Plan roughly one pizza for every one and a half guests, and include some vegetarian and vegan options. It is better to reorder than to run out or to throw pizza away.

## Make a POAP {#poaps}

A POAP is a collectable badge guests can claim to show they were there. Making one for your party is a nice touch, and it is also one of the missions. The steps are in [make a POAP](/handbook/make-a-poap).

## Announce your party {#announce}

Tell people early and more than once. Post the event page on your social accounts, share it in the community Discord, and ask the comms crew for help with a post or a graphic. Tag the official accounts so the community can share it too.

::if hashtags
Use these hashtags: {{hashtags}}
::end

## On the day {#day-of}

- Arrive early, check the oven or the delivery order, and set up a welcome table.
- Greet people at the door. Some guests will not know anyone.
- Join the community call if there is a global one that day, and show your party on screen.
- Take photos and a short video. Ask guests for permission before posting their faces.
- Keep every receipt, even for small purchases.

## After the party {#after}

1. **Collect your receipts** and list what was spent against your approved budget.
2. **Request reimbursement.** Payment requirements can differ by country, so ask the events crew if you are unsure what is needed.
3. **Share a recap.** Post your photos and a few lines on how it went in Discord and on social media.
4. **Say thank you** to your venue, your co-hosts and your guests.

::if paymentFormUrl
Submit your reimbursement request with the [payment form]({{paymentFormUrl}}).
::end

::if gppDate
## Global Pizza Party {#gpp}

The next Global Pizza Party is on {{gppDate}}. Parties all over the world celebrate together on the same day.

This is edition {{gppEdition}}.
::end

::if hostDeadlines
## Deadlines {#deadlines}

{{hostDeadlines}}
::end
`
