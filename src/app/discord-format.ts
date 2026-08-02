export type DiscordWrapKind =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'spoiler'
  | 'code'
  | 'codeblock'

const WRAP: Record<DiscordWrapKind, { open: string; close: string; multiline?: boolean }> = {
  bold: { open: '**', close: '**' },
  italic: { open: '*', close: '*' },
  underline: { open: '__', close: '__' },
  strikethrough: { open: '~~', close: '~~' },
  spoiler: { open: '||', close: '||' },
  code: { open: '`', close: '`' },
  codeblock: { open: '```\n', close: '\n```', multiline: true },
}

export interface TextareaSelectionResult {
  value: string
  selectionStart: number
  selectionEnd: number
}

/** Wrap the current selection (or insert empty markers) with Discord markdown. */
export function wrapDiscordMarkdown(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  kind: DiscordWrapKind,
  maxLength: number,
): TextareaSelectionResult {
  const start = Math.max(0, Math.min(selectionStart, value.length))
  const end = Math.max(start, Math.min(selectionEnd, value.length))
  const { open, close } = WRAP[kind]
  const selected = value.slice(start, end)
  const nextSelected = selected || (kind === 'codeblock' ? '' : '')
  const insertion = `${open}${nextSelected}${close}`

  let next = value.slice(0, start) + insertion + value.slice(end)
  if (next.length > maxLength) {
    next = next.slice(0, maxLength)
  }

  const cursorStart = start + open.length
  const cursorEnd = Math.min(cursorStart + nextSelected.length, next.length)
  return {
    value: next,
    selectionStart: cursorStart,
    selectionEnd: cursorEnd,
  }
}

/** Insert plain text (e.g. emoji) at the caret / replacing selection. */
export function insertAtSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  insertion: string,
  maxLength: number,
): TextareaSelectionResult {
  const start = Math.max(0, Math.min(selectionStart, value.length))
  const end = Math.max(start, Math.min(selectionEnd, value.length))
  let next = value.slice(0, start) + insertion + value.slice(end)
  if (next.length > maxLength) {
    const room = Math.max(0, maxLength - (value.length - (end - start)))
    insertion = insertion.slice(0, room)
    next = value.slice(0, start) + insertion + value.slice(end)
  }
  const caret = start + insertion.length
  return { value: next, selectionStart: caret, selectionEnd: caret }
}

export function applyToTextarea(
  el: HTMLTextAreaElement,
  result: TextareaSelectionResult,
): void {
  el.value = result.value
  el.focus()
  el.setSelectionRange(result.selectionStart, result.selectionEnd)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
