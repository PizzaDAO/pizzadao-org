-- Additive: where an attendance row came from, and who the recorder saw in the voice channel.
ALTER TABLE "CallAttendance" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'sheet';
ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "participantIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
