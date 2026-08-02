/** Discord markdown-compatible emoji catalog for the review editor. */

export interface EmojiEntry {
  /** Text inserted into the review (Unicode or <:name:id>). */
  insert: string
  /** Short label for title/tooltip. */
  label: string
  /** Optional Discord CDN image for custom emoji. */
  imageUrl?: string
}

function discordCdn(id: string): string {
  return `https://cdn.discordapp.com/emojis/${id}.png?size=48&quality=lossless`
}

function custom(name: string, id: string): EmojiEntry {
  return {
    insert: `<:${name}:${id}>`,
    label: name,
    imageUrl: discordCdn(id),
  }
}

/** Custom emojis from the TFM Discord (aligned with xero3.0/resources/emoji.py). */
export const DISCORD_CUSTOM_EMOJIS: EmojiEntry[] = [
  custom('megaphone', '1462059059547996291'),
  custom('tribe', '1268226448741634191'),
  custom('crane', '1268226442429206538'),
  custom('suggestion', '1268226431008374885'),
  custom('vanilla', '1267471660563300403'),
  custom('postit', '1267471648987156521'),
  custom('poll', '1267471636223758399'),
  custom('parchment', '1267471622747459634'),
  custom('gear', '1267471603311186001'),
  custom('discuss', '1267471590321422438'),
  custom('P66', '1267471504216559708'),
  custom('P43', '1267471492988272772'),
  custom('P42', '1267471482737528842'),
  custom('P41', '1267471470863585282'),
  custom('P38', '1516594775510487060'),
  custom('P37', '1516216322734690344'),
  custom('P34', '1267471456787239024'),
  custom('P32', '1267471443000692832'),
  custom('P27', '1516216367689240606'),
  custom('P24', '1267471404648103957'),
  custom('P23', '1267471391637377057'),
  custom('P22', '1267471380149043301'),
  custom('P21', '1267471366010179665'),
  custom('P20', '1267471352420634756'),
  custom('P19', '1267471340903071826'),
  custom('P18', '1267471330421374987'),
  custom('P17', '1267471316013940777'),
  custom('P13', '1267471302621659240'),
  custom('P12', '1460790442936238245'),
  custom('P11', '1267471289061212252'),
  custom('P10', '1267471278105825321'),
  custom('P9', '1267471264004440154'),
  custom('P8', '1267471251564400640'),
  custom('P7', '1267471237672730720'),
  custom('P6', '1267471225723293737'),
  custom('P5', '1267471211558867007'),
  custom('P4', '1267471198778953791'),
  custom('P3', '1267471165149155370'),
  custom('P2', '1267471151282651136'),
  custom('P1', '1267471139098198148'),
  custom('P0', '1267471127467524149'),
]

/** Common Unicode emojis useful in map reviews. */
export const UNICODE_EMOJIS: EmojiEntry[] = [
  { insert: '✅', label: 'check' },
  { insert: '❌', label: 'cross' },
  { insert: '⚠️', label: 'warning' },
  { insert: '❗', label: 'exclamation' },
  { insert: '❓', label: 'question' },
  { insert: '👍', label: 'thumbs up' },
  { insert: '👎', label: 'thumbs down' },
  { insert: '🔥', label: 'fire' },
  { insert: '💡', label: 'idea' },
  { insert: '⭐', label: 'star' },
  { insert: '✨', label: 'sparkles' },
  { insert: '❤️', label: 'heart' },
  { insert: '💔', label: 'broken heart' },
  { insert: '😂', label: 'joy' },
  { insert: '😅', label: 'sweat smile' },
  { insert: '🙂', label: 'smile' },
  { insert: '🤔', label: 'thinking' },
  { insert: '👀', label: 'eyes' },
  { insert: '🙏', label: 'pray' },
  { insert: '👏', label: 'clap' },
  { insert: '🎉', label: 'party' },
  { insert: '📌', label: 'pin' },
  { insert: '📝', label: 'memo' },
  { insert: '🔧', label: 'wrench' },
  { insert: '🛠️', label: 'tools' },
  { insert: '🗺️', label: 'map' },
  { insert: '🐭', label: 'mouse' },
  { insert: '🧀', label: 'cheese' },
  { insert: '🏹', label: 'bow' },
  { insert: '⏱️', label: 'timer' },
  { insert: '➡️', label: 'right' },
  { insert: '⬅️', label: 'left' },
  { insert: '⬆️', label: 'up' },
  { insert: '⬇️', label: 'down' },
]

export function renderEmojiPickerHtml(): string {
  const renderGroup = (title: string, items: EmojiEntry[]) => `
    <div class="emojiGroup">
      <div class="emojiGroupTitle">${title}</div>
      <div class="emojiGrid">
        ${items
          .map((e) => {
            const visual = e.imageUrl
              ? `<img src="${e.imageUrl}" alt="${e.label}" loading="lazy" />`
              : `<span>${e.insert}</span>`
            return `<button type="button" class="emojiBtn" data-insert="${encodeURIComponent(e.insert)}" title="${e.label}">${visual}</button>`
          })
          .join('')}
      </div>
    </div>
  `

  return `
    <div class="emojiPicker" id="reviewEmojiPicker" hidden>
      ${renderGroup('Server', DISCORD_CUSTOM_EMOJIS)}
      ${renderGroup('Emoji', UNICODE_EMOJIS)}
    </div>
  `
}
