#!/usr/bin/env bash
set -euo pipefail
activation_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
activation_container="pizzadao-activation-migration-$$"
docker run --rm -d --name "$activation_container" -e POSTGRES_PASSWORD=local-test-only -e POSTGRES_DB=activation_test postgres:17 >/dev/null
trap 'docker stop "$activation_container" >/dev/null' EXIT
for attempt in {1..30}; do
  if docker exec "$activation_container" pg_isready -U postgres -d activation_test >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$activation_container" psql -U postgres -d activation_test -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE "MagicLoginToken" (
 "id" TEXT PRIMARY KEY, "tokenHash" TEXT UNIQUE NOT NULL, "discordId" TEXT NOT NULL,
 "username" TEXT NOT NULL, "nick" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
 "usedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "MagicLoginToken" ("id", "tokenHash", "discordId", "username", "expiresAt") VALUES ('legacy', 'test-hash', 'test-discord', 'test-user', CURRENT_TIMESTAMP + INTERVAL '10 minutes');
SQL
docker exec -i "$activation_container" psql -U postgres -d activation_test -v ON_ERROR_STOP=1 < "$activation_repo/prisma/migrations/20261010000000_member_activation/migration.sql"
docker exec -i "$activation_container" psql -U postgres -d activation_test -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM "MagicLoginToken" WHERE id = 'legacy' AND "signupDraft" IS NULL) THEN RAISE EXCEPTION 'Existing login token was altered'; END IF;
END $$;
UPDATE "MagicLoginToken" SET "signupDraft" = '{"mafiaName":"Test","city":"Paris","sessionId":"test-session"}'::jsonb WHERE id = 'legacy';
INSERT INTO "ActivationEvent" (id, actor, event) VALUES ('1', 'test-session', 'signup_started');
INSERT INTO "ActivationEvent" (id, actor, event) VALUES ('2', 'test-session', 'signup_started') ON CONFLICT (actor, event, code) DO NOTHING;
DO $$ BEGIN
 IF (SELECT count(*) FROM "ActivationEvent") <> 1 THEN RAISE EXCEPTION 'Deduplication failed'; END IF;
 IF (SELECT "signupDraft"->>'city' FROM "MagicLoginToken" WHERE id = 'legacy') <> 'Paris' THEN RAISE EXCEPTION 'Draft storage failed'; END IF;
END $$;
SQL
printf 'PASS: migration preserves existing tokens, stores drafts, and deduplicates activation events.\n'
