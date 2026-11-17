/** Who may see a profile section the member can hide (passport, events attended). */

export type SectionVisibility = 'public' | 'members' | 'private'

export function parseVisibility(v: unknown): SectionVisibility {
  return v === 'members' || v === 'private' || v === 'public' ? v : 'public'
}

export type Viewer = 'owner' | 'member' | 'anonymous'

export function canView(visibility: SectionVisibility, viewer: Viewer): boolean {
  if (viewer === 'owner') return true
  if (visibility === 'private') return false
  if (visibility === 'members') return viewer === 'member'
  return true
}
