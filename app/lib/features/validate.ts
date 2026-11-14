/** Input validation for the /admin/features editor. */
import { z } from 'zod'
import { isSettingKey } from '@/app/lib/settings/registry'
import { isSafePath, isSafeRepo } from './links'
import { APP_KINDS, AUDIENCES, ENTRY_STATUSES } from './types'

const slug = z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, digits and dashes')
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null))
const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https:\/\/\S+$/i.test(v), 'Must start with https://')
const optUrl = z.union([z.literal('').transform(() => null), z.null(), httpUrl])
/** A live link: a path on the app's own site ("/start") or an http(s) URL. */
const optLiveUrl = z.union([z.literal('').transform(() => null), z.null(), httpUrl, z.string().trim().max(300).regex(/^\/[^\s]*$/, 'A path starting with /')])

export const codeRefSchema = z.object({
  repo: z.string().trim().min(1).max(120).refine(isSafeRepo, 'A repo name: letters, digits, dot, dash and underscore'),
  path: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === '' || isSafePath(v), 'A repo-relative path: no leading slash, no . or .. segments, letters digits . _ - @ + ~ ( ) [ ] only')
    .optional(),
  description: z.string().trim().max(200).optional(),
  private: z.boolean().optional(),
})

export const appPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    tagline: z.string().trim().max(140),
    url: optUrl,
    repo: optText(120),
    repoPrivate: z.boolean(),
    defaultBranch: optText(80),
    license: optText(60),
    licenseNote: optText(200),
    kind: z.enum(APP_KINDS),
    position: z.number().int().min(0).max(100000),
    published: z.boolean(),
  })
  .partial()
  .strict()

export const appCreateSchema = appPatchSchema.extend({ slug, name: z.string().trim().min(1).max(80) })

export const entryPatchSchema = z
  .object({
    appSlug: slug,
    title: z.string().trim().min(1).max(100),
    summary: z.string().trim().min(1).max(160),
    body: optText(5000),
    audiences: z.array(z.enum(AUDIENCES)).max(AUDIENCES.length),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    status: z.enum(ENTRY_STATUSES),
    access: z.string().trim().regex(/^(public|members|admin|level:[A-Za-z0-9]+)$/, 'public, members, admin or level:N'),
    toggleKey: z
      .union([z.literal('').transform(() => null), z.null(), z.string().trim().max(100)])
      .refine((v) => v === null || isSettingKey(v), 'Must be a known settings key'),
    liveUrl: optLiveUrl,
    docsUrl: optUrl,
    code: z.array(codeRefSchema).max(40),
    published: z.boolean(),
    showWhenOff: z.boolean(),
    position: z.number().int().min(0).max(100000),
    markReviewed: z.boolean(),
  })
  .partial()
  .strict()

export const entryCreateSchema = entryPatchSchema.extend({ slug, appSlug: slug, title: z.string().trim().min(1).max(100), summary: z.string().trim().min(1).max(160) })

export const bulkPublishSchema = z.object({
  published: z.boolean(),
  /** An app slug to limit it to; omitted: everything. */
  appSlug: slug.optional(),
})
