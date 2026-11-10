/**
 * Countries for the map levels (pure). The ISO numeric codes are the ids the pizzadao.org map's
 * world-atlas features use, so the public payload carries them for the choropleth.
 *
 * English names come from Intl.DisplayNames (no dependency); the spelling forms members actually
 * type are in COUNTRY_ALIASES below. These are facts, not tunables; admin aliases sit on top.
 */

/** ISO 3166-1 alpha-2 -> numeric (zero padded), for every country the map can colour. */
export const ISO_NUMERIC: Readonly<Record<string, string>> = {
  'AF': '004',
  'AL': '008',
  'AQ': '010',
  'DZ': '012',
  'AS': '016',
  'AD': '020',
  'AO': '024',
  'AG': '028',
  'AZ': '031',
  'AR': '032',
  'AU': '036',
  'AT': '040',
  'BS': '044',
  'BH': '048',
  'BD': '050',
  'AM': '051',
  'BB': '052',
  'BE': '056',
  'BM': '060',
  'BT': '064',
  'BO': '068',
  'BA': '070',
  'BW': '072',
  'BR': '076',
  'BZ': '084',
  'IO': '086',
  'SB': '090',
  'VG': '092',
  'BN': '096',
  'BG': '100',
  'MM': '104',
  'BI': '108',
  'BY': '112',
  'KH': '116',
  'CM': '120',
  'CA': '124',
  'CV': '132',
  'KY': '136',
  'CF': '140',
  'LK': '144',
  'TD': '148',
  'CL': '152',
  'CN': '156',
  'TW': '158',
  'CO': '170',
  'KM': '174',
  'CG': '178',
  'CD': '180',
  'CK': '184',
  'CR': '188',
  'HR': '191',
  'CU': '192',
  'CY': '196',
  'CZ': '203',
  'BJ': '204',
  'DK': '208',
  'DM': '212',
  'DO': '214',
  'EC': '218',
  'SV': '222',
  'GQ': '226',
  'ET': '231',
  'ER': '232',
  'EE': '233',
  'FO': '234',
  'FK': '238',
  'GS': '239',
  'FJ': '242',
  'FI': '246',
  'AX': '248',
  'FR': '250',
  'PF': '258',
  'TF': '260',
  'DJ': '262',
  'GA': '266',
  'GE': '268',
  'GM': '270',
  'PS': '275',
  'DE': '276',
  'GH': '288',
  'KI': '296',
  'GR': '300',
  'GL': '304',
  'GD': '308',
  'GU': '316',
  'GT': '320',
  'GN': '324',
  'GY': '328',
  'HT': '332',
  'HM': '334',
  'VA': '336',
  'HN': '340',
  'HK': '344',
  'HU': '348',
  'IS': '352',
  'IN': '356',
  'ID': '360',
  'IR': '364',
  'IQ': '368',
  'IE': '372',
  'IL': '376',
  'IT': '380',
  'CI': '384',
  'JM': '388',
  'JP': '392',
  'KZ': '398',
  'JO': '400',
  'KE': '404',
  'KP': '408',
  'KR': '410',
  'KW': '414',
  'KG': '417',
  'LA': '418',
  'LB': '422',
  'LS': '426',
  'LV': '428',
  'LR': '430',
  'LY': '434',
  'LI': '438',
  'LT': '440',
  'LU': '442',
  'MO': '446',
  'MG': '450',
  'MW': '454',
  'MY': '458',
  'MV': '462',
  'ML': '466',
  'MT': '470',
  'MR': '478',
  'MU': '480',
  'MX': '484',
  'MC': '492',
  'MN': '496',
  'MD': '498',
  'ME': '499',
  'MS': '500',
  'MA': '504',
  'MZ': '508',
  'OM': '512',
  'NA': '516',
  'NR': '520',
  'NP': '524',
  'NL': '528',
  'CW': '531',
  'AW': '533',
  'SX': '534',
  'NC': '540',
  'VU': '548',
  'NZ': '554',
  'NI': '558',
  'NE': '562',
  'NG': '566',
  'NU': '570',
  'NF': '574',
  'NO': '578',
  'MP': '580',
  'FM': '583',
  'MH': '584',
  'PW': '585',
  'PK': '586',
  'PA': '591',
  'PG': '598',
  'PY': '600',
  'PE': '604',
  'PH': '608',
  'PN': '612',
  'PL': '616',
  'PT': '620',
  'GW': '624',
  'TL': '626',
  'PR': '630',
  'QA': '634',
  'RO': '642',
  'RU': '643',
  'RW': '646',
  'BL': '652',
  'SH': '654',
  'KN': '659',
  'AI': '660',
  'LC': '662',
  'MF': '663',
  'PM': '666',
  'VC': '670',
  'SM': '674',
  'ST': '678',
  'SA': '682',
  'SN': '686',
  'RS': '688',
  'SC': '690',
  'SL': '694',
  'SG': '702',
  'SK': '703',
  'VN': '704',
  'SI': '705',
  'SO': '706',
  'ZA': '710',
  'ZW': '716',
  'ES': '724',
  'SS': '728',
  'SD': '729',
  'EH': '732',
  'SR': '740',
  'SZ': '748',
  'SE': '752',
  'CH': '756',
  'SY': '760',
  'TJ': '762',
  'TH': '764',
  'TG': '768',
  'TO': '776',
  'TT': '780',
  'AE': '784',
  'TN': '788',
  'TR': '792',
  'TM': '795',
  'TC': '796',
  'UG': '800',
  'UA': '804',
  'MK': '807',
  'EG': '818',
  'GB': '826',
  'GG': '831',
  'JE': '832',
  'IM': '833',
  'TZ': '834',
  'US': '840',
  'VI': '850',
  'BF': '854',
  'UY': '858',
  'UZ': '860',
  'VE': '862',
  'WF': '876',
  'WS': '882',
  'YE': '887',
  'ZM': '894',
}

export const ISO_ALPHA2 = Object.keys(ISO_NUMERIC)

export function isIso2(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(ISO_NUMERIC, code)
}

/** Lowercase, no accents, `&` -> and, dots dropped, whitespace collapsed. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Spelling forms and short names members type for a country (normalised text -> alpha-2). */
export const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  usa: 'US',
  us: 'US',
  america: 'US',
  'united states': 'US',
  'united states of america': 'US',
  uk: 'GB',
  gb: 'GB',
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  'united kingdom': 'GB',
  uae: 'AE',
  'ivory coast': 'CI',
  turkiye: 'TR',
  drc: 'CD',
  'democratic republic of the congo': 'CD',
  'republic of the congo': 'CG',
  korea: 'KR',
  'south korea': 'KR',
  'republic of korea': 'KR',
  'north korea': 'KP',
  holland: 'NL',
  'the netherlands': 'NL',
  czechia: 'CZ',
  'czech republic': 'CZ',
  russia: 'RU',
  turkey: 'TR',
  myanmar: 'MM',
  'hong kong': 'HK',
  macau: 'MO',
  macao: 'MO',
  palestine: 'PS',
  vatican: 'VA',
  'east timor': 'TL',
  vietnam: 'VN',
  'viet nam': 'VN',
  burma: 'MM',
  swaziland: 'SZ',
  'cape verde': 'CV',
  macedonia: 'MK',
  'north macedonia': 'MK',
}

let reverse: Map<string, string> | null = null

function reverseNames(): Map<string, string> {
  if (reverse) return reverse
  const m = new Map<string, string>()
  const dn = new Intl.DisplayNames(['en'], { type: 'region' })
  for (const code of ISO_ALPHA2) {
    let name: string | undefined
    try {
      name = dn.of(code)
    } catch {
      continue
    }
    if (name && name !== code) m.set(normalizeText(name), code)
  }
  reverse = m
  return m
}

/** The English name of a country by alpha-2 (falls back to the code). */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

/** Alpha-2 for normalised country text: a built-in spelling form or an English name. Never a bare 2-letter code. */
export function countryFromText(normalized: string): string | null {
  if (!normalized) return null
  const alias = COUNTRY_ALIASES[normalized]
  if (alias) return alias
  return reverseNames().get(normalized) ?? null
}
