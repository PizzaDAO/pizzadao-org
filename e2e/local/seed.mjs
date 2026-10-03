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
const { NEW_MEMBER, COMPLETE_MEMBER, MEMBERS } = fixtures;

const MISSIONS = [
  { level: 1, index: 0, title: "Follow @RarePizzas and @Pizza_DAO on X", reward: 69, levelTitle: "Pizza Trainee", autoVerify: true },
  { level: 2, index: 0, title: "Say hi on a community or crew call", reward: 420, levelTitle: "Pizza Noob", autoVerify: false },
  { level: 2, index: 1, title: "Post about PizzaDAO", reward: 420, levelTitle: "Pizza Noob", autoVerify: false },
  { level: 3, index: 0, title: "Share your community in #show-and-tell", reward: 1337, levelTitle: null, autoVerify: true },
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

  console.log(`[e2e:local] seeded ${MEMBERS.length} test members (${NEW_MEMBER.memberId}, ${COMPLETE_MEMBER.memberId}) and ${MISSIONS.length} missions`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
