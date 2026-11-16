-- Reminders can go to Discord, Telegram, or both. Additive: existing rows keep their value.
ALTER TYPE "ReminderChannel" ADD VALUE 'BOTH';
