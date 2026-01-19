export interface CategoryMeta {
  code: string // ex: "P4"
  description: string
  picture?: string
  color?: string
  submissionLimit?: number
  decisions: Array<'left_as_is' | 'p1ed' | 'will_be_discussed' | 'ignored'>
  reviewed: boolean
}

// Copiado/adaptado de `xero3.0/resources/category_list.py`.
// - reviewed=true apenas para categorias de review (P3..P11, P17, P18, P24)
// - decisions definidas conforme regra do review + "ignored"
export const CATEGORIES: CategoryMeta[] = [
  {
    code: 'P0',
    description: 'Standard (P0)',
    picture: 'https://i.imgur.com/nzndLpV.png',
    color: '#B6B3AA',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P1',
    description: 'Protected (P1)',
    picture: 'https://i.imgur.com/ndBCphI.png',
    color: '#FEC861',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P2',
    description: 'Prime (P2)',
    picture: 'https://i.imgur.com/ndBCphI.png',
    color: '#FFD481',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P3',
    description: 'Bootcamp (P3)',
    picture: 'https://i.imgur.com/EyWCJ2R.png',
    color: '#717B3C',
    submissionLimit: 3,
    decisions: ['left_as_is', 'will_be_discussed', 'ignored'],
    reviewed: true,
  },
  {
    code: 'P4',
    description: 'Shaman (P4)',
    picture: 'https://i.imgur.com/43fUNoX.png',
    color: '#95D9D6',
    submissionLimit: 4,
    decisions: ['left_as_is', 'p1ed', 'will_be_discussed', 'ignored'],
    reviewed: true,
  },
  {
    code: 'P5',
    description: 'Art (P5)',
    picture: 'https://i.imgur.com/DWqAcW0.png',
    color: '#C24A1F',
    submissionLimit: 4,
    decisions: ['left_as_is', 'p1ed', 'will_be_discussed', 'ignored'],
    reviewed: true,
  },
  {
    code: 'P6',
    description: 'Mechanism (P6)',
    picture: 'https://i.imgur.com/deE6DIX.png',
    color: '#D8D8D9',
    submissionLimit: 4,
    decisions: ['left_as_is', 'p1ed', 'will_be_discussed', 'ignored'],
    reviewed: true,
  },
  {
    code: 'P7',
    description: 'No Shaman (P7)',
    picture: 'https://i.imgur.com/kb1U7IH.png',
    color: '#332C26',
    submissionLimit: 4,
    decisions: ['left_as_is', 'p1ed', 'will_be_discussed', 'ignored'],
    reviewed: true,
  },
  {
    code: 'P8',
    description: 'Double Shaman (P8)',
    picture: 'https://i.imgur.com/dMCj6ZN.png',
    color: '#FBA5F0',
    submissionLimit: 4,
    decisions: ['left_as_is', 'p1ed', 'will_be_discussed', 'ignored'],
    reviewed: true,
  },
  {
    code: 'P9',
    description: 'Miscellaneous (P9)',
    picture: 'https://i.imgur.com/y4FcHyi.png',
    color: '#FFD480',
    submissionLimit: 4,
    decisions: ['left_as_is', 'p1ed', 'will_be_discussed', 'ignored'],
    reviewed: true,
  },
  {
    code: 'P10',
    description: 'Survivor (P10)',
    picture: 'https://i.imgur.com/GSzC6qh.png',
    color: '#353434',
    submissionLimit: 2,
    decisions: ['left_as_is', 'will_be_discussed', 'ignored'],
    reviewed: true,
  },
  {
    code: 'P11',
    description: 'Vampire Surv (P11)',
    picture: 'https://i.imgur.com/m6atPga.png',
    color: '#544931',
    submissionLimit: 2,
    decisions: ['left_as_is', 'will_be_discussed', 'ignored'],
    reviewed: true,
  },
  {
    code: 'P12',
    description: 'Mechanism no Shaman (P12)',
    picture: 'https://i.imgur.com/euUbAfn.png',
    color: '#D8D8D9',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P13',
    description: 'Lower bootcamp (P13)',
    picture: 'https://i.imgur.com/Q8Mf3AX.png',
    color: '#8E9565',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P17',
    description: 'Racing (P17)',
    picture: 'https://i.imgur.com/sgNPHFA.png',
    color: '#C32C12',
    submissionLimit: 2,
    decisions: ['left_as_is', 'p1ed', 'will_be_discussed', 'ignored'],
    reviewed: true,
  },
  {
    code: 'P18',
    description: 'Defilante (P18)',
    picture: 'https://i.imgur.com/H0FpaWH.png',
    color: '#7DCA24',
    submissionLimit: 5,
    decisions: ['left_as_is', 'will_be_discussed', 'ignored'],
    reviewed: true,
  },
  {
    code: 'P19',
    description: 'Music (P19)',
    picture: 'https://i.imgur.com/dWkfUyX.png',
    color: '#9CABB5',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P20',
    description: 'Normal Survivor Test (P20)',
    picture: 'https://i.imgur.com/1dyJuy5.png',
    color: '#353434',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P21',
    description: 'Vampire Survivor Test (P21)',
    picture: 'https://i.imgur.com/v4UqRSb.png',
    color: '#544931',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P22',
    description: 'Tribe house (P22)',
    picture: 'https://i.imgur.com/X2bHHoq.png',
    color: '#7E5F40',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P23',
    description: 'Bootcamp Test (P23)',
    picture: 'https://i.imgur.com/UmSCzcs.png',
    color: '#717B3C',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P24',
    description: 'Dual Surv (P24)',
    picture: 'https://i.imgur.com/PWDFBDW.png',
    color: '#C3C3C3',
    submissionLimit: 3,
    decisions: ['left_as_is', 'will_be_discussed', 'ignored'],
    reviewed: true,
  },
  {
    code: 'P32',
    description: 'Double Shaman Test (P32)',
    picture: 'https://i.imgur.com/nd09QvE.png',
    color: '#FBA5F0',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P34',
    description: 'Dual Shaman Survivor Test (P34)',
    picture: 'https://i.imgur.com/7Pc6fHb.png',
    color: '#C3C3C3',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P41',
    description: 'Minigame (P41)',
    picture: 'https://i.imgur.com/OG0CIW3.png',
    color: '#F7BF54',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P42',
    description: 'No Shaman Test (P42)',
    picture: 'https://i.imgur.com/hUEXr2K.png',
    color: '#95D9D6',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P43',
    description: 'Inappropriate (P43)',
    picture: 'https://i.imgur.com/Bu1k0Px.png',
    color: '#F50000',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P60',
    description: 'Thematic Test (P60)',
    picture: 'https://i.imgur.com/yJuncPP.png',
    color: '#368DCB',
    decisions: ['ignored'],
    reviewed: false,
  },
  {
    code: 'P66',
    description: 'Thematic (P66)',
    picture: 'https://i.imgur.com/yJuncPP.png',
    color: '#368DCB',
    submissionLimit: -1,
    decisions: ['left_as_is', 'p1ed', 'will_be_discussed', 'ignored'],
    reviewed: true,
  },
]

export type ReviewedCategoryCode =
  | 'P3'
  | 'P4'
  | 'P5'
  | 'P6'
  | 'P7'
  | 'P8'
  | 'P9'
  | 'P10'
  | 'P11'
  | 'P17'
  | 'P18'
  | 'P24'
  | 'P66'

export const REVIEW_CATEGORIES: CategoryMeta[] = CATEGORIES.filter((c) => c.reviewed)

export function findCategory(code: string): CategoryMeta | null {
  const t = code.trim().toUpperCase()
  if (!t) return null
  const normalized = t.startsWith('P') ? t : `P${t}`
  return CATEGORIES.find((c) => c.code === normalized) ?? null
}

export function parseCategoryNumber(code: string): number | null {
  const c = findCategory(code)
  const raw = (c?.code ?? code).trim().toUpperCase()
  const normalized = raw.startsWith('P') ? raw.slice(1) : raw
  const n = Number.parseInt(normalized, 10)
  return Number.isFinite(n) ? n : null
}

