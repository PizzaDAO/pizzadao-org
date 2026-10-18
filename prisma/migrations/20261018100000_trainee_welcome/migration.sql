-- oregano-41907: durable record that a new joiner was welcomed (DM + channel)
-- after being named Pizza Trainee. The row is claimed before sending, so a
-- member is welcomed at most once across overlapping runs, restarts, role
-- removal and leave/rejoin. ADDITIVE ONLY; re-runnable.
CREATE TABLE IF NOT EXISTS "TraineeWelcome" (
    "discordId" TEXT NOT NULL,
    "welcomedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dm" TEXT,
    "channel" TEXT,

    CONSTRAINT "TraineeWelcome_pkey" PRIMARY KEY ("discordId")
);
