/**
 * Role lists that come from the admin settings, falling back to the built-in lists when nothing is
 * saved. Saved ids were checked against the server when they were saved.
 */
import { ARTICLE_AUTHOR_ROLE_IDS, DREAD_PIZZA_ROBERTS_ROLE_ID } from '@/app/ui/constants'
import { getSetting } from './index'

/** Roles that may publish articles: the saved list, else the built-in one. Never throws. */
export async function articleAuthorRoleIds(): Promise<readonly string[]> {
  try {
    const saved = await getSetting('articles.authorRoleIds')
    // Dread Pizza Roberts is always included, whatever is saved.
    return saved.length ? [...new Set([...saved, DREAD_PIZZA_ROBERTS_ROLE_ID])] : ARTICLE_AUTHOR_ROLE_IDS
  } catch {
    return ARTICLE_AUTHOR_ROLE_IDS
  }
}
