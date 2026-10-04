// e2e/local/seed.mjs
//
// Seeds the throwaway local Postgres with the rows the logged-in pages need
// for the synthetic test members in fixtures.cjs. Idempotent: it wipes the
// test members' rows first, so every run starts from the same state (in
// particular profileCompletedCelebratedAt = null for the "complete" member).
//
// Must run with the preload (it uses the app's Neon adapter):
//   node --require ./e2e/local/preload.cjs e2e/local/seed.mjs
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import fixtures from "./fixtures.cjs";

const url = process.env.DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1"].includes(host)) {
  console.error(`[e2e:local] refusing to seed non-local DATABASE_URL host "${host}"`);
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });
const { NEW_MEMBER, COMPLETE_MEMBER, SHOP_ADMIN_MEMBER, MEMBERS } = fixtures;

const MISSIONS = [
  // Verifier settings as in app/lib/mission-verify/mission-config.ts (Phase 1).
  { level: 1, index: 0, title: "Link your X account and follow @RarePizzas + @Pizza_DAO", reward: 69, levelTitle: "Pizza Trainee", verifierKey: "x_linked", verifierParams: {} },
  { level: 2, index: 0, title: "Say hi on a community or crew call", reward: 420, levelTitle: "Pizza Noob", verifierKey: "attendance_count", verifierParams: { min: 1, crews: "any" } },
  { level: 2, index: 1, title: "Post about PizzaDAO", reward: 420, levelTitle: "Pizza Noob", verifierKey: "social_post", verifierParams: { minReplies: 3, minLikes: 10, platforms: ["x", "farcaster"] }, proofKind: "URL" },
  { level: 3, index: 0, title: "Share your community in #show-and-tell", reward: 1337, levelTitle: null, verifierKey: "discord_message", verifierParams: { channelName: "show-and-tell" }, proofKind: "DISCORD_MESSAGE" },
];

async function main() {
  const discordIds = MEMBERS.map((m) => m.discordId);
  const memberIds = MEMBERS.map((m) => m.memberId);

  // Reset test members.
  await prisma.notification.deleteMany({ where: { recipientId: { in: discordIds } } });
  await prisma.missionCompletion.deleteMany({ where: { discordId: { in: discordIds } } });
  await prisma.transaction.deleteMany({ where: { userId: { in: discordIds } } });
  await prisma.xAccount.deleteMany({ where: { discordId: { in: discordIds } } });
  await prisma.memberWallet.deleteMany({ where: { memberId: { in: memberIds } } });
  await prisma.memberProfileExtras.deleteMany({ where: { memberId: { in: memberIds } } });
  await prisma.economy.deleteMany({ where: { id: { in: discordIds } } });
  await prisma.user.deleteMany({ where: { id: { in: discordIds } } });

  for (const m of MISSIONS) {
    await prisma.mission.upsert({
      where: { level_index: { level: m.level, index: m.index } },
      create: { ...m, description: m.title, isActive: true },
      update: {},
    });
  }

  for (const m of MEMBERS) {
    await prisma.user.create({ data: { id: m.discordId, roles: [] } });
    await prisma.economy.create({ data: { id: m.discordId, wallet: m === COMPLETE_MEMBER ? 4200 : 69 } });
    await prisma.memberProfileExtras.create({
      data: { memberId: m.memberId, locale: "en", tagline: `Synthetic e2e member ${m.memberId}`, profileCompletedCelebratedAt: null },
    });
    await prisma.notification.create({
      data: {
        type: "VOUCH_ADDED",
        recipientId: m.discordId,
        title: "Welcome to the e2e run",
        message: "Seeded notification for the local logged-in smoke test.",
        linkUrl: `/dashboard/${m.memberId}`,
      },
    });
  }

  // Complete member: wallet + X (crew comes from the fixture sheet row).
  await prisma.memberWallet.create({
    data: {
      memberId: COMPLETE_MEMBER.memberId,
      discordId: COMPLETE_MEMBER.discordId,
      walletAddress: COMPLETE_MEMBER.wallet,
      label: "Main",
      source: "e2e",
      isPrimary: true,
    },
  });
  await prisma.xAccount.create({
    data: {
      discordId: COMPLETE_MEMBER.discordId,
      memberId: COMPLETE_MEMBER.memberId,
      xId: "e2e-x-990002",
      xUsername: COMPLETE_MEMBER.xUsername,
      xDisplayName: "E2E Fake X",
      accessToken: "fake-e2e-token",
    },
  });

  // Complete member: Level 1 was approved by a reviewer (and paid) while they
  // were away, and never celebrated. /missions must show the level-up modal on
  // the next visit, once. firstMissionCelebratedAt is set so the first-mission
  // overlay doesn't take its place.
  const l1 = await prisma.mission.findUniqueOrThrow({ where: { level_index: { level: 1, index: 0 } } });
  await prisma.missionCompletion.create({
    data: {
      missionId: l1.id,
      discordId: COMPLETE_MEMBER.discordId,
      memberId: COMPLETE_MEMBER.memberId,
      status: "APPROVED",
      reviewedBy: "e2e-reviewer",
      reviewedAt: new Date(),
    },
  });
  await prisma.transaction.create({
    data: {
      userId: COMPLETE_MEMBER.discordId,
      type: "MISSION_REWARD",
      amount: 69,
      balance: 4200,
      description: "Mission reward: Level 1 - Pizza Trainee",
      metadata: { level: 1 },
    },
  });
  await prisma.memberProfileExtras.update({
    where: { memberId: COMPLETE_MEMBER.memberId },
    data: { firstMissionCelebratedAt: new Date(), lastCelebratedLevel: 0 },
  });

  // Shop (/pep shop, /admin/shop): one item of each kind, a purchase, holdings
  // and a few audit rows by the shop admin fixture.
  await prisma.inventory.deleteMany({ where: { userId: { in: discordIds } } });
  await prisma.itemGrant.deleteMany({ where: { discordId: { in: discordIds } } });
  await prisma.shopAdminEvent.deleteMany({ where: { actorId: SHOP_ADMIN_MEMBER.discordId } });
  const item = (name, data) => prisma.shopItem.upsert({ where: { name }, create: { name, ...data }, update: data });
  const box = await item("E2E Rare Pizza Box", { description: "Numbered box from the first print run.", price: 500, quantity: 7, isAvailable: true, isCollectible: false });
  await item("E2E Pizza Party Hat", { description: "One size fits most.", price: 69, quantity: -1, isAvailable: true, isCollectible: false });
  const apron = await item("E2E Retired Apron", { description: "Off sale since the last season.", price: 120, quantity: 0, isAvailable: false, isCollectible: false });
  const pin = await item("E2E Molto Benny Pin", { description: "Carried over from UnbelievaBoat.", price: 1, quantity: -1, isAvailable: false, isCollectible: true });
  await prisma.transaction.create({
    data: {
      userId: SHOP_ADMIN_MEMBER.discordId,
      type: "SHOP_PURCHASE",
      amount: -1000,
      balance: 69,
      description: `Purchased 2x ${box.name}`,
      metadata: { itemId: box.id, itemName: box.name, quantity: 2 },
    },
  });
  await prisma.inventory.create({ data: { userId: SHOP_ADMIN_MEMBER.discordId, itemId: box.id, quantity: 2 } });
  await prisma.inventory.create({ data: { userId: NEW_MEMBER.discordId, itemId: pin.id, quantity: 1 } });
  const actorId = SHOP_ADMIN_MEMBER.discordId;
  await prisma.shopAdminEvent.create({ data: { actorId, action: "RESTOCK", itemId: box.id, itemName: box.name, quantity: 5, before: { quantity: 2 }, after: { quantity: 7 }, reason: "Second print run arrived" } });
  await prisma.shopAdminEvent.create({ data: { actorId, action: "HIDE", itemId: apron.id, itemName: apron.name, before: { isAvailable: true }, after: { isAvailable: false }, reason: "Out of season" } });
  await prisma.shopAdminEvent.create({ data: { actorId, action: "GRANT", itemId: pin.id, itemName: pin.name, targetId: NEW_MEMBER.discordId, quantity: 1, after: { status: "CREDITED" }, reason: "UB carry-over" } });

  // /pep jobs + bounties: three daily jobs and two bounties (one open, one
  // claimed) so the job and bounty cards render with real data.
  await prisma.jobAssignment.deleteMany({ where: { userId: { in: discordIds } } });
  await prisma.bounty.deleteMany({ where: { createdBy: { in: discordIds } } });
  await prisma.job.deleteMany({ where: { description: { startsWith: "E2E " } } });
  for (const [description, type] of [
    ["E2E Share a pizza photo in #general", "Social"],
    ["E2E Welcome a new member on a crew call", "Community"],
    ["E2E Review one open pull request", "Tech"],
  ]) {
    await prisma.job.create({ data: { description, type, isActive: true } });
  }
  await prisma.bounty.create({
    data: { description: "E2E Design a flyer for the Testville pizza party", reward: 1500, createdBy: COMPLETE_MEMBER.discordId, status: "OPEN" },
  });
  await prisma.bounty.create({
    data: { description: "E2E Translate the onboarding guide to Spanish", reward: 250, createdBy: SHOP_ADMIN_MEMBER.discordId, claimedBy: COMPLETE_MEMBER.discordId, status: "CLAIMED" },
  });

  console.log(`[e2e:local] seeded ${MEMBERS.length} test members (${MEMBERS.map((m) => m.memberId).join(", ")}), ${MISSIONS.length} missions, 4 shop items, 3 jobs and 2 bounties`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
