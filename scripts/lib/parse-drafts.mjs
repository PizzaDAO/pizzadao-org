// Parse markdown files into crew-draft records (used by scripts/seed-crew-drafts.mjs).
//
// Format: drafts are separated by a line containing only `---`. A section may
// start with `key: value` lines (platform, media, notes), then a blank line or
// the text. A `# Heading` line at the top of a section becomes the notes
// (unless `notes:` is given). Sections with no body text are dropped. Without
// a `platform:` line, the platform comes from the file name ("linkedin" in the
// name = linkedin, "discord", "telegram", otherwise x).

const PLATFORMS = ['x', 'linkedin', 'discord', 'telegram']

export function platformFromFilename(name) {
  const n = String(name || '').toLowerCase()
  return PLATFORMS.find((p) => p !== 'x' && n.includes(p)) ?? 'x'
}

export function parseDraftsMarkdown(markdown, filename = '') {
  const fallback = platformFromFilename(filename)
  const sections = String(markdown).replace(/\r\n/g, '\n').split(/^\s*---\s*$/m)
  const out = []
  for (const raw of sections) {
    const lines = raw.replace(/^\n+|\s+$/g, '').split('\n')
    const meta = {}
    let heading = null
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      const kv = line.match(/^(platform|media|notes):\s*(.*)$/i)
      if (kv) {
        meta[kv[1].toLowerCase()] = kv[2].trim()
        i++
      } else if (heading === null && /^#{1,6}\s+/.test(line)) {
        heading = line.replace(/^#{1,6}\s+/, '').trim()
        i++
      } else if (line.trim() === '' && i < lines.length) {
        // blank lines between meta and body
        if (Object.keys(meta).length || heading !== null) i++
        else break
      } else break
    }
    const text = lines.slice(i).join('\n').trim()
    if (!text) continue
    const platform = (meta.platform || fallback).toLowerCase()
    if (!PLATFORMS.includes(platform)) throw new Error(`Unknown platform "${platform}" in ${filename || 'input'}`)
    out.push({
      platform,
      text,
      mediaUrl: meta.media || null,
      notes: meta.notes || heading || null,
    })
  }
  return out
}
