// Test helper: a tiny in-memory stand-in for prisma.newsletterSubscriber (fake data only).
export interface FakeSub {
  id: string;
  email: string;
  source: string;
  status: string;
  createdAt: Date;
  confirmedAt: Date | null;
  confirmSentAt: Date | null;
  confirmSends: number;
  unsubscribedAt: Date | null;
  memberId: string | null;
  locale: string;
  lastStatusReason: string | null;
}

type Where = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Where[]).some((w) => matches(row, w));
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { not?: unknown; lt?: Date };
      if ("not" in c) return v !== c.not;
      if ("lt" in c) return v instanceof Date && v.getTime() < (c.lt as Date).getTime();
    }
    return v === cond;
  });
}

export function makeFakeDb(seed: Array<Partial<FakeSub> & { email: string }> = []) {
  let n = 0;
  const rows: FakeSub[] = [];
  const add = (p: Partial<FakeSub> & { email: string }): FakeSub => {
    const row: FakeSub = {
      id: `sub${++n}`,
      source: "journal",
      status: "subscribed",
      createdAt: new Date(1_700_000_000_000 + n),
      confirmedAt: null,
      confirmSentAt: null,
      confirmSends: 0,
      unsubscribedAt: null,
      memberId: null,
      locale: "en",
      lastStatusReason: null,
      ...p,
    };
    rows.push(row);
    return row;
  };
  seed.forEach(add);
  const pick = <T extends object>(row: FakeSub | undefined, select?: T) =>
    row ? (select ? Object.fromEntries(Object.keys(select).map((k) => [k, (row as never)[k]])) : { ...row }) : null;
  const newsletterSubscriber = {
    findUnique: async ({ where, select }: { where: Where; select?: object }) =>
      pick(rows.find((r) => matches(r as never, where)), select),
    create: async ({ data, select }: { data: Partial<FakeSub> & { email: string }; select?: object }) => {
      if (rows.some((r) => r.email === data.email)) throw Object.assign(new Error("dup"), { code: "P2002" });
      return pick(add(data), select);
    },
    update: async ({ where, data }: { where: Where; data: Partial<FakeSub> }) => {
      const r = rows.find((x) => matches(x as never, where));
      if (!r) throw new Error("missing");
      Object.assign(r, data);
      return { ...r };
    },
    updateMany: async ({ where, data }: { where: Where; data: Partial<FakeSub> }) => {
      const hit = rows.filter((x) => matches(x as never, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    count: async ({ where }: { where?: Where } = {}) => rows.filter((r) => matches(r as never, where ?? {})).length,
    findMany: async ({ where, take, orderBy }: { where?: Where; take?: number; orderBy?: { createdAt: "asc" | "desc" } }) => {
      let out = rows.filter((r) => matches(r as never, where ?? {}));
      if (orderBy) out = [...out].sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) * (orderBy.createdAt === "asc" ? 1 : -1));
      return out.slice(0, take).map((r) => ({ ...r }));
    },
  };
  return { rows, add, prisma: { newsletterSubscriber } };
}

/** A settings snapshot like loadSettings() returns, with only the given values set. */
export function fakeSettings(values: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    "marketing.newsletterEnabled": true,
    "newsletter.confirmEmailsEnabled": false,
    "newsletter.memberOptInEnabled": false,
    "newsletter.fromName": "",
    "newsletter.fromAddress": "",
    "newsletter.replyTo": "",
  };
  const all = { ...defaults, ...values };
  return {
    readFailed: false,
    invalidKeys: [] as string[],
    isSet: (k: string) => k in all,
    get: (k: string) => all[k],
  };
}
