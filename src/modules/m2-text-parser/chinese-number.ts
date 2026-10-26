const DIGITS: Readonly<Record<string, number>> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}
const PLACES: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000 }

function integerValue(text: string): number | undefined {
  if (!text) return undefined
  if (/^[零〇一二两三四五六七八九]+$/.test(text)) {
    return Number([...text].map(char => DIGITS[char]).join(''))
  }

  let total = 0
  let previousPlace = 10000
  let digit: number | undefined
  let skippedPlace = false
  for (const char of text) {
    const place = PLACES[char]
    if (place !== undefined) {
      if (place >= previousPlace || (skippedPlace && place >= previousPlace / 10)) return undefined
      // Only a leading 十 has an implicit coefficient: 十二 = 一十二.
      const coefficient = digit ?? (total === 0 && place === 10 && !skippedPlace ? 1 : undefined)
      if (coefficient === undefined) return undefined
      total += coefficient * place
      previousPlace = place
      digit = undefined
      skippedPlace = false
      continue
    }
    const next = DIGITS[char]
    if (next === undefined || digit !== undefined) return undefined
    if (next === 0) {
      if (!total || skippedPlace || previousPlace <= 10) return undefined
      skippedPlace = true
    } else {
      digit = next
    }
  }
  if (skippedPlace && digit === undefined) return undefined
  // Colloquial trailing digits occupy the next place: 一百二 = 120;
  // an explicit 零 restores the ones place: 一百零二 = 102.
  return total + (digit ?? 0) * (skippedPlace ? 1 : Math.max(previousPlace / 10, 1))
}

/** Parse the complete supported Chinese numeral, bounded before unit conversion. */
export function parseChineseNumber(text: string): number | undefined {
  const parts = text.split('点')
  if (parts.length > 2) return undefined
  const integer = integerValue(parts[0] ?? '')
  if (integer === undefined) return undefined
  const fraction = parts[1]
  if (fraction !== undefined && !/^[零〇一二两三四五六七八九]+$/.test(fraction)) return undefined
  const value = integer + (fraction === undefined ? 0 : Number(`0.${[...fraction].map(char => DIGITS[char]).join('')}`))
  return Number.isFinite(value) && value <= 1000 ? value : undefined
}
