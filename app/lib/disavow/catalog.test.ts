// @vitest-environment node
// The disavow catalogs are separate from the root ones; keep the three in sync.
import { describe, it, expect } from 'vitest'
import { createTranslator } from 'next-intl'
import en from '../../../messages/disavow/en.json'
import es from '../../../messages/disavow/es.json'
import fr from '../../../messages/disavow/fr.json'

type Cat = { [k: string]: string | Cat }
const flat = (o: Cat, p = ''): Map<string, string> => {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k
    if (typeof v === 'string') out.set(key, v)
    else for (const [ck, cv] of flat(v, key)) out.set(ck, cv)
  }
  return out
}
const args = (m: string) => [...new Set([...m.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map(x => x[1]))].sort().join()

describe('disavow catalogs', () => {
  const base = flat(en as Cat)
  for (const [loc, cat] of [['es', es], ['fr', fr]] as const) {
    it(`${loc} has exactly the keys and placeholders of en`, () => {
      const f = flat(cat as Cat)
      expect([...f.keys()].sort()).toEqual([...base.keys()].sort())
      for (const [k, v] of base) expect(args(f.get(k)!)).toBe(args(v))
      expect([...f.values()].every(v => v.trim() !== '')).toBe(true)
    })
  }
  it('every message is valid ICU', () => {
    for (const [loc, cat] of [['en', en], ['es', es], ['fr', fr]] as const) {
      const errors: string[] = []
      const t = createTranslator({ locale: loc, messages: { disavow: cat } as never, onError: e => errors.push(e.message) })
      for (const [k, v] of flat(cat as Cat)) {
        const values = Object.fromEntries(args(v).split(',').filter(Boolean).map(n => [n, 2]))
        ;(t as unknown as (key: string, values: object) => string)(`disavow.${k}`, values)
      }
      expect(errors).toEqual([])
    }
  })
  it('has the nav label', () => {
    expect(base.get('navLabel')).toBeTruthy()
  })
})
