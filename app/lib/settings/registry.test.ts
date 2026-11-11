// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { SETTINGS, SETTING_KEYS, TRANSCRIPTION_KEYTERMS_DEFAULT, isSettingKey, parseSetting } from './registry'
import { ECONOMY_SETTINGS } from './economy-settings'
import { CONTENT_SETTINGS } from './content-settings'

const ECONOMY_KEYS = new Set<string>([...Object.keys(ECONOMY_SETTINGS), ...Object.keys(CONTENT_SETTINGS)])
import { CALL_TRANSCRIPT_MIN_LEVEL, CALL_SUMMARY_MIN_LEVEL, CALL_ACTION_ITEMS_MIN_LEVEL, CALL_CHAPTERS_MIN_LEVEL } from '@/app/lib/calls/transcript-access'
import { HUMAN_RELEASE_MIN_LEVEL, NEW_ACCOUNT_DAYS } from '@/app/lib/mission-verify/policy'
import { DPR_ONLY_MIN_LEVEL } from '@/app/lib/mission-review-access'
import {
  DISAVOW_APPEAL_COOLDOWN_DAYS, DISAVOW_DECISION_DAYS, DISAVOW_LISTING_MONTHS, DISAVOW_MIN_LEVEL, DISAVOW_NOMINATIONS_PER_WINDOW,
  DISAVOW_NOMINATION_WINDOW_DAYS, DISAVOW_WINDOW_DAYS, DISAVOW_YES_THRESHOLD,
} from '@/app/lib/disavow/constants'
import { SLA_HOURS, DIGEST_MAX_LINES } from '@/app/lib/mission-verify/sla'
import { MAX_MISSION_ATTEMPTS } from '@/app/lib/missions'

describe('settings registry', () => {
  it('has unique, well-formed keys and no secret-like names', () => {
    expect(new Set(SETTING_KEYS).size).toBe(SETTING_KEYS.length)
    for (const key of SETTING_KEYS) {
      expect(key).toMatch(/^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/)
      // "city keys" are rsv.pizza directory names (public), not credentials.
      expect(key.replace(/CityKeys$/, '')).not.toMatch(/secret|token|key|password/i)
      expect(SETTINGS[key].key).toBe(key)
    }
  })

  it('every default passes its own schema and failure values are integers', () => {
    for (const key of SETTING_KEYS) {
      const def = SETTINGS[key]
      expect(parseSetting(key, def.default).ok).toBe(true)
      // A failure value may sit outside the editable bounds on purpose (the strictest value, e.g. level 1).
      if (def.input.type === 'int') {
        if (typeof def.onReadFailure === 'object') expect(Number.isInteger(def.onReadFailure.value)).toBe(true)
        expect(def.input.min).toBeLessThanOrEqual(def.default as number)
        expect(def.input.max).toBeGreaterThanOrEqual(def.default as number)
      } else if (['text', 'date', 'url', 'channel', 'role'].includes(def.input.type)) {
        expect(typeof def.default).toBe('string')
      }
    }
  })

  it('locks every default to the constant it replaced (deploying changes no behaviour)', () => {
    expect(SETTINGS['calls.transcriptMinLevel'].default).toBe(CALL_TRANSCRIPT_MIN_LEVEL)
    expect(SETTINGS['calls.summaryMinLevel'].default).toBe(CALL_SUMMARY_MIN_LEVEL)
    expect(SETTINGS['calls.actionItemsMinLevel'].default).toBe(CALL_ACTION_ITEMS_MIN_LEVEL)
    expect(SETTINGS['calls.chaptersMinLevel'].default).toBe(CALL_CHAPTERS_MIN_LEVEL)
    expect(SETTINGS['missions.humanReleaseMinLevel'].default).toBe(HUMAN_RELEASE_MIN_LEVEL)
    expect(SETTINGS['missions.newAccountDays'].default).toBe(NEW_ACCOUNT_DAYS)
    expect(SETTINGS['missions.dprOnlyMinLevel'].default).toBe(DPR_ONLY_MIN_LEVEL)
    expect(SETTINGS['disavow.minLevel'].default).toBe(DISAVOW_MIN_LEVEL)
    expect(SETTINGS['missions.slaHours'].default).toBe(SLA_HOURS)
    expect(SETTINGS['missions.slaDigestMaxLines'].default).toBe(DIGEST_MAX_LINES)
    expect(SETTINGS['missions.maxAttempts'].default).toBe(MAX_MISSION_ATTEMPTS)
    expect(SETTINGS['disavow.yesThreshold'].default).toBe(DISAVOW_YES_THRESHOLD)
    expect(SETTINGS['disavow.decisionDays'].default).toBe(DISAVOW_DECISION_DAYS)
    expect(SETTINGS['disavow.windowDays'].default).toBe(DISAVOW_WINDOW_DAYS)
    expect(SETTINGS['disavow.nominationsPerWindow'].default).toBe(DISAVOW_NOMINATIONS_PER_WINDOW)
    expect(SETTINGS['disavow.nominationWindowDays'].default).toBe(DISAVOW_NOMINATION_WINDOW_DAYS)
    expect(SETTINGS['disavow.listingMonths'].default).toBe(DISAVOW_LISTING_MONTHS)
    expect(SETTINGS['disavow.appealCooldownDays'].default).toBe(DISAVOW_APPEAL_COOLDOWN_DAYS)
    // Telegram city mirrors: every switch off, no groups chosen, pacing as planned.
    expect(SETTING_KEYS.filter((k) => k.startsWith('telegram.') && !k.startsWith('telegram.dm')).map((k) => [k, SETTINGS[k].default])).toEqual([
      ['telegram.cityPostsEnabled', false],
      ['telegram.recapMirrorEnabled', false],
      ['telegram.agendaMirrorEnabled', false],
      ['telegram.announceMirrorEnabled', false],
      ['telegram.hostMatchEnabled', false],
      ['telegram.hostMatchDiscordLine', 'Prefer Telegram? Confirm here: {link}'],
      ['telegram.hostMatchConfirmText', 'Confirm this Telegram for your PizzaDAO account. Only tap the button if you just asked for this in the PizzaDAO app.'],
      ['telegram.hostMatchConfirmButton', 'Confirm'],
      ['telegram.hostMatchInviteText', 'PizzaDAO would like to send you call follow-ups here. Tap the button to confirm, or ignore this message.'],
      ['telegram.hostMatchInviteButton', 'Confirm'],
      ['telegram.crewCityGroups', []],
      ['telegram.announceCityKeys', []],
      ['telegram.maxSendsPerRun', 25],
      ['telegram.groupGapSeconds', 10],
      ['telegram.postMaxAgeHours', 12],
      ['telegram.hostMatchMode', 1],
      ['telegram.hostMatchRecheckDays', 14],
      ['telegram.hostMatchDailyHashes', 1000],
    ])
    // And the literal values today (a change here is a deliberate, reviewed change).
    expect(SETTING_KEYS.filter((k) => !k.startsWith('guide.') && !k.startsWith('followups.') && !k.startsWith('payments.') && !k.startsWith('proposals.') && !k.startsWith('telegram.') && !k.startsWith('sheets.') && !k.startsWith('map.') && !k.startsWith('reminders.') && !ECONOMY_KEYS.has(k)).map((k) => [k, SETTINGS[k].default])).toEqual([
      ['calls.transcriptMinLevel', 6],
      ['calls.summaryMinLevel', 5],
      ['calls.actionItemsMinLevel', 4],
      ['calls.chaptersMinLevel', 3],
      ['missions.humanReleaseMinLevel', 6],
      ['missions.newAccountDays', 30],
      ['missions.dprOnlyMinLevel', 8],
      ['missions.slaHours', 48],
      ['missions.slaDigestMaxLines', 15],
      ['missions.maxAttempts', 3],
      ['disavow.minLevel', 5],
      ['passport.enabled', 0],
      ['passport.checkInRadiusM', 150],
      ['passport.maxAccuracyM', 150],
      ['passport.maxNewStampsPerDay', 5],
      ['passport.revisitCooldownHours', 20],
      ['passport.publicDelayHours', 6],
      ['passport.maxTravelKmPerHour', 900],
      // Phase 3: disavow voting rules.
      ['disavow.yesThreshold', 3],
      ['disavow.decisionDays', 7],
      ['disavow.windowDays', 14],
      ['disavow.nominationsPerWindow', 3],
      ['disavow.nominationWindowDays', 30],
      ['disavow.listingMonths', 12],
      ['disavow.appealCooldownDays', 90],
      // Phase 3: switches default to the behaviour before they existed (env is the fallback; see toggles.ts)...
      ['missions.verifiersEnabled', false],
      ['missions.reviewCardsEnabled', false],
      ['calls.recapPostEnabled', false],
      ['calls.recapMentionPing', true],
      ['calls.agendaPostEnabled', false],
      ['calls.agendaLinks', ''],
      ['calls.attendanceExcludeIds', ''],
      ['calls.attendanceCrewAliases', 'community = community_call'],
      ['calls.recordableVoiceChannels', ''],
      ['calls.crewVoiceChannels', ''],
      ['calls.attendanceMinMinutes', 5],
      ['calls.attendanceShortCallPercent', 50],
      ['calls.attendanceSpeakersAlwaysCount', true],
      ['calls.welcomeEnabled', false],
      ['calls.welcomeTemplate', 'Welcome {members} to the {call} 🍕'],
      ['calls.welcomeBatchSeconds', 20],
      ['calls.recordingLine', "🔴 This call is recorded and transcribed; audio stays private. Leave the call if you'd rather not be recorded."],
      ['calls.startNotice', ''],
      ['calls.endSongTriggerEnabled', false],
      ['calls.endSongMinHumans', 1],
      ['calls.startBandEnabled', false],
      ['calls.startBandCalls', 'Community Call'],
      ['calls.transcriptionTerms', TRANSCRIPTION_KEYTERMS_DEFAULT],
      ['calls.startBandMaxSongs', 1],
      ['calls.supersedeMaxDeferMinutes', 30],
      ['calls.dstFixEnabled', false],
      ['calls.dstFixDryRun', true],
      ['calls.dstFixMaxShiftMinutes', 120],
      ['calls.endSongCrewMap', 'Ops = Ops\nTech = Tech\nComms = Comms\nBiz Dev = Biz Dev\nEvents = Events\nArt = Art\nMerch = Merch\nReal Estate = Real Estate\nGovernance = Governance'],
      ['calls.progressReportEnabled', false],
      ['calls.progressMaxItems', 8],
      ['calls.progressShowFollowups', false],
      ['calls.liveActionItemsEnabled', false],
      ['calls.chatActionItemsEnabled', false],
      ['calls.liveActionItemsCrews', ''],
      ['calls.liveChunkSeconds', 150],
      ['calls.liveWindowMinutes', 8],
      ['calls.liveActionItemsMaxPerCall', 10],
      ['calls.liveMaxChunksPerCall', 40],
      ['calls.liveMaxAudioMinutesPerCall', 120],
      ['calls.liveViewEnabled', false],
      ['calls.liveStreamLinks', ''],
      ['calls.livePushSeconds', 20],
      ['calls.liveStaleSeconds', 120],
      ['calls.liveHostRoleIds', ''],
      ['calls.liveQuestionMaxPerMember', 5],
      ['calls.liveQuestionMinGapSeconds', 20],
      ['calls.livePollSeconds', 10],
      ['calls.liveItemsRetentionDays', 30],
      ['calls.chatActionPrefixes', 'action:, ai:, todo:'],
      ['calls.liveActionItemsModel', ''],
      ['calls.liveActionItemNote', 'Added to the call notes for review.'],
      ['calls.taskProposalsEnabled', false],
      ['calls.taskProposalsCrews', ''],
      ['calls.taskProposalsMaxPerCall', 15],
      ['calls.taskProposalMaxDays', 14],
      ['calls.taskProposalsModel', ''],
      ['calls.taskProposalsNudgeEnabled', false],
      ['vouches.dailyLimit', 50],
      ['vouches.requestsEnabled', false],
      ['vouches.requestDailyLimit', 5],
      ['vouches.requestCooldownDays', 14],
      ['vouches.quickVouchEnabled', false],
      ['vouches.showVouchersEnabled', false],
      ['dashboard.levelCardEnabled', false],
      ['dashboard.startHereMaxLevel', 2],
      ['discord.vouchCommandEnabled', false],
      ['discord.levelCommandEnabled', false],
      ['discord.profileCommandEnabled', false],
      ['calls.importedRecapPostEnabled', false],
      ['calls.importedFollowupsEnabled', false],
      ['calls.importedAgendaContext', false],
      ['calls.importedAutoSummarize', false],
      ['calls.attendanceFromRecordings', false],
      ['calls.bulkActionMax', 50],
      ['disavow.enabled', false],
      ['reengage.enabled', false],
      ['onboarding.traineeNickEnabled', false],
      ['names.requireThemed', false],
      ['mafia.rankFreshHours', 26],
      ['mafia.rankPrecomputeConcurrency', 4],
      ['games.enabled', false],
      ['crime.enabled', false],
      ['portrait.enabled', false],
      ['pfp.restyleEnabled', false],
      ['pfp.restylePerUnlock', 2],
      ['pfp.restyleDailyLimit', 3],
      ['pfp.restyleMonthlyBudgetUsd', 50],
      ['pfp.restyleRefusalDailyLimit', 3],
      ['pfp.restyleCostCents', 20],
      ['pfp.outfitOverlayEnabled', false],
      ['jobs.verifyPosts', true],
      ['jobs.unverifiableJobsPayOnClick', true],
      ['tickets.discoveryTerms', 'pizza\npizzadao\npizza party\nbitcoin pizza day'],
      ['tickets.scanIntervalHours', 24],
      ['tickets.rescanCooldownMinutes', 10],
      ['shop.itemGrantsEnabled', true],
      ['shop.sheetSyncEnabled', false],
      // ...and channels and roles to "not set here" (the env value, then the built-in id, apply).
      ['discord.missionReviewChannelId', ''],
      ['discord.missionsAnnounceChannelId', ''],
      ['discord.announceChannelId', ''],
      ['discord.callVoiceChannelId', ''],
      ['discord.dstFixChannelId', ''],
      ['discord.proposalsChannelId', ''],
      ['discord.proposalsOpsChannelId', ''],
      ['discord.supportChannelId', ''],
      ['discord.spotlightChannelId', ''],
      ['discord.suggestionsChannelId', ''],
      ['discord.welcomeChannelId', ''],
      ['discord.proposalsPingRoleId', ''],
      ['missions.slaPingRoleId', ''],
      ['missions.reviewerRoleIds', []],
      ['announce.roleIds', []],
      ['articles.authorRoleIds', []],
      ['calls.eventLocalTimes', []],
    ])
  })

  it('welcome template needs both placeholders; the recording line can never be empty', () => {
    expect(parseSetting('calls.welcomeTemplate', 'Hi {members}').ok).toBe(false)
    expect(parseSetting('calls.welcomeTemplate', 'Hi {call}').ok).toBe(false)
    expect(parseSetting('calls.welcomeTemplate', 'Hi {members} to {call}').ok).toBe(true)
    expect(parseSetting('calls.recordingLine', '   ').ok).toBe(false)
    expect(parseSetting('calls.recordingLine', 'We record.').ok).toBe(true)
    expect(parseSetting('calls.startNotice', '').ok).toBe(true)
    expect(parseSetting('calls.startNotice', 'x'.repeat(501)).ok).toBe(false)
    expect(parseSetting('calls.endSongCrewMap', 'Ops = Ops\nCommunity').ok).toBe(false)
    expect(parseSetting('calls.endSongCrewMap', 'Ops = Ops\nBiz Dev = Biz Dev').ok).toBe(true)
    expect(parseSetting('calls.welcomeBatchSeconds', 4).ok).toBe(false)
    expect(parseSetting('calls.welcomeBatchSeconds', 121).ok).toBe(false)
  })

  it('enforces bounds, integers and types', () => {
    expect(parseSetting('calls.transcriptMinLevel', 0).ok).toBe(false)
    expect(parseSetting('calls.transcriptMinLevel', 10).ok).toBe(false)
    expect(parseSetting('calls.transcriptMinLevel', 9).ok).toBe(true)
    expect(parseSetting('calls.transcriptMinLevel', 1).ok).toBe(true)
    expect(parseSetting('calls.transcriptMinLevel', 5.5).ok).toBe(false)
    expect(parseSetting('calls.transcriptMinLevel', '6').ok).toBe(false)
    expect(parseSetting('calls.transcriptMinLevel', null).ok).toBe(false)
    expect(parseSetting('missions.slaHours', 337).ok).toBe(false)
    expect(parseSetting('missions.slaDigestMaxLines', 26).ok).toBe(false)
    expect(parseSetting('missions.maxAttempts', 11).ok).toBe(false)
    expect(parseSetting('missions.maxAttempts', 0).ok).toBe(false)
  })

  it('approval-authority settings can only be made stricter', () => {
    // Lowering is allowed, loosening is rejected by the bounds.
    expect(parseSetting('missions.dprOnlyMinLevel', 7).ok).toBe(true)
    expect(parseSetting('missions.dprOnlyMinLevel', 8).ok).toBe(true)
    expect(parseSetting('missions.dprOnlyMinLevel', 9).ok).toBe(false)
    expect(parseSetting('missions.dprOnlyMinLevel', 1).ok).toBe(false)
    expect(parseSetting('missions.humanReleaseMinLevel', 5).ok).toBe(true)
    expect(parseSetting('missions.humanReleaseMinLevel', 7).ok).toBe(false)
    expect(parseSetting('missions.newAccountDays', 60).ok).toBe(true)
    expect(parseSetting('missions.newAccountDays', 29).ok).toBe(false)
    for (const k of ['missions.dprOnlyMinLevel', 'missions.humanReleaseMinLevel', 'missions.newAccountDays'] as const) {
      expect(SETTINGS[k].stricterOnly).toBe(true)
    }
  })

  it('money-hold and approval settings fail to their strictest value', () => {
    expect(SETTINGS['missions.humanReleaseMinLevel'].onReadFailure).toEqual({ value: 1 })
    expect(SETTINGS['missions.newAccountDays'].onReadFailure).toEqual({ value: 365 })
    expect(SETTINGS['missions.dprOnlyMinLevel'].onReadFailure).toEqual({ value: 1 })
  })

  it('asks for confirmation when a content-access threshold is lowered', () => {
    const c = SETTINGS['calls.transcriptMinLevel'].confirm!
    expect(c(6, 4)).toMatch(/transcripts/i)
    expect(c(6, 8)).toBeNull()
    expect(SETTINGS['disavow.minLevel'].confirm!(5, 3)).not.toBeNull()
    expect(SETTINGS['disavow.minLevel'].confirm!(5, 7)).toBeNull()
  })

  it('disavow vote rules can only be made stricter (threshold 3+, decision time 7+ days), and are bounded', () => {
    expect(parseSetting('disavow.yesThreshold', 2).ok).toBe(false)
    expect(parseSetting('disavow.yesThreshold', 1).ok).toBe(false)
    expect(parseSetting('disavow.yesThreshold', 3).ok).toBe(true)
    expect(parseSetting('disavow.yesThreshold', 5).ok).toBe(true)
    expect(parseSetting('disavow.yesThreshold', 21).ok).toBe(false)
    expect(parseSetting('disavow.decisionDays', 6).ok).toBe(false)
    expect(parseSetting('disavow.decisionDays', 10).ok).toBe(true)
    expect(parseSetting('disavow.decisionDays', 31).ok).toBe(false)
    for (const k of ['disavow.yesThreshold', 'disavow.decisionDays'] as const) expect(SETTINGS[k].stricterOnly).toBe(true)
    expect(parseSetting('disavow.windowDays', 61).ok).toBe(false)
    expect(parseSetting('disavow.listingMonths', 0).ok).toBe(false)
    expect(parseSetting('disavow.appealCooldownDays', 6).ok).toBe(false)
  })

  it('proposals settings ship off, stricter-only, and fail to the strictest value', () => {
    expect(SETTINGS['proposals.enabled'].default).toBe(false)
    expect(SETTINGS['proposals.windowDays'].default).toBe(7)
    expect(SETTINGS['proposals.generalAyes'].default).toBe(15)
    // The history display settings: off until switched on, bounded page size, validated explorer JSON.
    expect(SETTINGS['proposals.historyEnabled'].default).toBe(false)
    expect(SETTINGS['proposals.pageSize'].default).toBe(50)
    expect(parseSetting('proposals.pageSize', 5).ok).toBe(false)
    expect(parseSetting('proposals.pageSize', 100).ok).toBe(true)
    expect(parseSetting('proposals.explorers', '').ok).toBe(true)
    expect(parseSetting('proposals.explorers', '{"base":"https://basescan.org/tx/{tx}"}').ok).toBe(true)
    expect(parseSetting('proposals.explorers', '{"base":"http://x/{tx}"}').ok).toBe(false)
    expect(parseSetting('proposals.windowDays', 6).ok).toBe(false)
    expect(parseSetting('proposals.windowDays', 7).ok).toBe(true)
    expect(parseSetting('proposals.windowDays', 15).ok).toBe(false)
    expect(parseSetting('proposals.generalAyes', 14).ok).toBe(false)
    expect(parseSetting('proposals.generalAyes', 20).ok).toBe(true)
    for (const k of ['proposals.windowDays', 'proposals.generalAyes'] as const) expect(SETTINGS[k].stricterOnly).toBe(true)
    expect(SETTINGS['proposals.windowDays'].onReadFailure).toEqual({ value: 14 })
  })

  it('go-live settings: pilot off, no go-live moment, the 30-day Sesh default, the strictest caps', () => {
    expect(SETTINGS['proposals.pilotDiscordIds'].default).toEqual([])
    expect(SETTINGS['proposals.pilotWindowMinutes'].default).toBe(60)
    expect(parseSetting('proposals.pilotWindowMinutes', 29).ok).toBe(false)
    expect(parseSetting('proposals.pilotWindowMinutes', 30).ok).toBe(true)
    expect(parseSetting('proposals.pilotWindowMinutes', 1441).ok).toBe(false)
    expect(parseSetting('proposals.pilotDiscordIds', ['100000000000000001']).ok).toBe(true)
    expect(parseSetting('proposals.pilotDiscordIds', ['not an id']).ok).toBe(false)
    expect(SETTINGS['proposals.liveSince'].default).toBe('')
    expect(parseSetting('proposals.liveSince', '2026-12-01T18:00:00Z').ok).toBe(true)
    expect(parseSetting('proposals.liveSince', '2026-12-01').ok).toBe(false)
    expect(parseSetting('proposals.liveSince', 'yesterday').ok).toBe(false)
    expect(parseSetting('proposals.liveSince', '').ok).toBe(true)
    expect(SETTINGS['proposals.seshLinksUntil'].default).toBe('')
    expect(parseSetting('proposals.seshLinksUntil', '2026-12-31').ok).toBe(true)
    expect(parseSetting('proposals.seshLinksUntil', '2026-02-30').ok).toBe(false)
    // open proposals per member: stricter-only, default 3, a failed read gives 1
    expect(SETTINGS['proposals.maxOpenPerProposer'].default).toBe(3)
    expect(SETTINGS['proposals.maxOpenPerProposer'].stricterOnly).toBe(true)
    expect(SETTINGS['proposals.maxOpenPerProposer'].onReadFailure).toEqual({ value: 1 })
    expect(parseSetting('proposals.maxOpenPerProposer', 4).ok).toBe(false)
    expect(parseSetting('proposals.maxOpenPerProposer', 0).ok).toBe(false)
    expect(parseSetting('proposals.maxOpenPerProposer', 1).ok).toBe(true)
    // the cap's help names the tier coupling, and lowering it asks first
    expect(SETTINGS['payments.onApprovalCapUsd'].help).toMatch(/second-tier ayes/)
    expect(SETTINGS['payments.onApprovalCapUsd'].confirm?.(625, 500)).toMatch(/Lowering the cap/)
    expect(SETTINGS['payments.onApprovalCapUsd'].confirm?.(500, 625)).toBeNull()
    // the ping role's intended value is documented but never hard-coded
    expect(SETTINGS['discord.proposalsPingRoleId'].help).toMatch(/Super Voter/)
    expect(SETTINGS['discord.proposalsPingRoleId'].default).toBe('')
  })

  it('guide settings ship unset so unconfirmed handbook facts stay hidden', () => {
    const guide = SETTING_KEYS.filter((k) => k.startsWith('guide.'))
    expect(guide.length).toBeGreaterThan(0)
    for (const k of guide) {
      expect(SETTINGS[k].area).toBe('guide')
      expect([0, '']).toContain(SETTINGS[k].default)
      expect(SETTINGS[k].private).toBeFalsy()
    }
  })

  it('url settings accept https only (or empty)', () => {
    const k = 'guide.budgetTemplateUrl'
    expect(parseSetting(k, '').ok).toBe(true)
    expect(parseSetting(k, 'https://example.org/a?b=1').ok).toBe(true)
    expect(parseSetting(k, 'http://example.org').ok).toBe(false)
    expect(parseSetting(k, 'javascript:alert(1)').ok).toBe(false)
    expect(parseSetting(k, 'data:text/html,hi').ok).toBe(false)
    expect(parseSetting(k, 'https://user:pw@example.org').ok).toBe(false)
    expect(parseSetting(k, 'not a url').ok).toBe(false)
    expect(parseSetting(k, 'https://example.org/' + 'a'.repeat(300)).ok).toBe(false)
    expect(parseSetting(k, 5).ok).toBe(false)
  })

  it('url settings store the canonical href (trimmed, backslashes normalised)', () => {
    const k = 'guide.budgetTemplateUrl'
    expect(parseSetting(k, ' https://example.org ')).toEqual({ ok: true, value: 'https://example.org/' })
    expect(parseSetting(k, 'https://example.org/a\\b')).toEqual({ ok: true, value: 'https://example.org/a/b' })
    expect(parseSetting(k, '')).toEqual({ ok: true, value: '' })
  })

  it('date settings accept real ISO dates (or empty) only', () => {
    const k = 'guide.gppDate'
    expect(parseSetting(k, '').ok).toBe(true)
    expect(parseSetting(k, '2027-05-22').ok).toBe(true)
    expect(parseSetting(k, '2027-02-30').ok).toBe(false)
    expect(parseSetting(k, '22/05/2027').ok).toBe(false)
    expect(parseSetting(k, '2027-5-22').ok).toBe(false)
    expect(parseSetting(k, 20270522).ok).toBe(false)
  })

  it('text settings are trimmed and length-bounded', () => {
    expect(parseSetting('guide.hashtags', '  #one #two ')).toEqual({ ok: true, value: '#one #two' })
    expect(parseSetting('guide.hashtags', 'x'.repeat(201)).ok).toBe(false)
    expect(parseSetting('guide.hostDeadlines', 'x'.repeat(1000)).ok).toBe(true)
    expect(parseSetting('guide.hostDeadlines', 'x'.repeat(1001)).ok).toBe(false)
  })

  it('isSettingKey rejects unknown and prototype keys', () => {
    expect(isSettingKey('calls.transcriptMinLevel')).toBe(true)
    expect(isSettingKey('nope')).toBe(false)
    expect(isSettingKey('constructor')).toBe(false)
    expect(isSettingKey('__proto__')).toBe(false)
  })
})
