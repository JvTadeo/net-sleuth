/**
 * Builds resources/oui.txt.gz, the offline table that turns the first half of a MAC address into a manufacturer name.
 *
 * Source: the IEEE OUI registry as packaged by `oui-data` (BSD-2-Clause). Only the company name is kept, shortened
 * ("SAMSUNG ELECTRONICS CO.,LTD" → "Samsung Electronics"). Run it when the registry should be refreshed:
 *
 *   npm pack oui-data && tar -xzf oui-data-*.tgz
 *   node scripts/build-oui.mjs package/index.json
 *
 * Output format, one line per prefix after a header of names: "<OUI hex>\t<name index in base 36>".
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const source = process.argv[2]
if (!source) {
  console.error('Usage: node scripts/build-oui.mjs <path to oui-data index.json>')
  process.exit(1)
}

const SUFFIXES =
  /[\s,.]+(co\.?,?\s*ltd\.?|company\s+limited|co\.?|ltd\.?|limited|inc\.?|incorporated|corp\.?|corporation|gmbh|ag|s\.?a\.?|s\.?p\.?a\.?|b\.?v\.?|llc|l\.?l\.?c\.?|plc|pty|pte|oy|ab|as|a\/s|srl|s\.?r\.?l\.?|kg|co\.?\s*kg|technologies|technology|tech|electronics co|international)\.?$/i

function shorten(raw) {
  let name = raw.split('\n')[0].trim().replace(/\s+/g, ' ')
  for (let i = 0; i < 4; i++) {
    const next = name.replace(SUFFIXES, '').trim()
    if (next === name || next.length < 2) break
    name = next
  }
  name = name.replace(/[,.\s]+$/, '')
  // ALL CAPS names read better in title case; short words stay upper case (TP-LINK → TP-Link, LG → LG).
  if (name === name.toUpperCase()) {
    name = name.replace(/[A-Z0-9]+/g, (w) => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()))
  }
  return name
}

const data = JSON.parse(readFileSync(source, 'utf8'))
const names = []
const index = new Map()
const lines = []
for (const [oui, value] of Object.entries(data).sort(([a], [b]) => a.localeCompare(b))) {
  if (!/^[0-9A-F]{6}$/.test(oui)) continue
  const name = shorten(String(value))
  if (!name || /^private$/i.test(name)) continue
  if (!index.has(name)) {
    index.set(name, names.length)
    names.push(name)
  }
  lines.push(`${oui}\t${index.get(name).toString(36)}`)
}
const text = `${names.join('\n')}\n\n${lines.join('\n')}\n`
writeFileSync(new URL('../resources/oui.txt.gz', import.meta.url), gzipSync(text, { level: 9 }))
console.log(`${lines.length} prefixes, ${names.length} names, ${(text.length / 1024).toFixed(0)} KB before compression`)
