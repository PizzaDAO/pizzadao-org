-- Additive: one row per call occurrence whose welcome message was handed to the recorder (idempotency claim).
CREATE TABLE IF NOT EXISTS "CallWelcome" (
    "occurrenceKey" TEXT NOT NULL,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallWelcome_pkey" PRIMARY KEY ("occurrenceKey")
);
