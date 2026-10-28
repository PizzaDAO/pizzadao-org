import { Prisma } from '@prisma/client'

/** Nullable Json columns reject a bare null: use the DB-null marker (null = "was default" / "reset"). */
export function jsonOrDbNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue)
}
