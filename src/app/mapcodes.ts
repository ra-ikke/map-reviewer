function stripWrappingQuotes(s: string): string {
  const t = s.trim()
  if (!t) return t
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim()
  }
  return t
}

function stripCommonPunctuation(s: string): string {
  // remove wrappers comuns (CSV / logs)
  let t = s.trim()
  t = t.replace(/^[<(\[]+/, '')
  t = t.replace(/[>\])]+$/, '')
  // remove pontuação no fim (",", ".", etc)
  t = t.replace(/[.,;:!?]+$/, '')
  return t.trim()
}

export function normalizeMapcode(raw: string): string | null {
  let t = raw.trim()
  if (!t) return null

  t = stripWrappingQuotes(t)
  t = stripCommonPunctuation(t)
  if (!t) return null

  // aceita copiar do chat com @mapcode
  t = t.replace(/^@+/, '')

  // se veio com texto extra, pega só o 1º token
  t = (t.split(/\s+/)[0] ?? '').trim()
  if (!t) return null

  // evita lixo óbvio (mantém flexível o suficiente para tokens comuns)
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(t)) return null

  return t
}

export function parseMapcodesFromText(text: string): string[] {
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalizedText.split('\n')
  const out: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // CSV: separadores comuns (vírgula / ponto-vírgula / TAB)
    const roughTokens = trimmed.split(/[,\t;]+/)
    const tokens: string[] = []
    for (const chunk of roughTokens) {
      const parts = chunk.split(/\s+/).filter(Boolean)
      tokens.push(...parts)
    }

    const hasAt = trimmed.includes('@')
    for (const tok of tokens) {
      if (hasAt && !tok.includes('@')) continue

      const mc = normalizeMapcode(tok)
      if (!mc) continue

      // quando não há "@", reduz falso-positivo (ex.: header CSV)
      if (!hasAt && !/\d/.test(mc)) continue

      out.push(mc)
    }
  }

  return out
}

export function uniqPreserveOrder(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const it of items) {
    if (seen.has(it)) continue
    seen.add(it)
    out.push(it)
  }
  return out
}

