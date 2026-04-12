-- AlterTable
ALTER TABLE "Article" ADD COLUMN "collaboratorMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
