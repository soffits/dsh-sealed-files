#!/usr/bin/env node
/**
 * Hand Sealed Files a yes or no for a device waiting to be added, from outside
 * the Web page (a chat button through a scheduled job, a script):
 *
 *   dsh-sealed-files-decide --state-dir DIR --device ID --code CODE --yes|--no [--person ID] [--by LABEL]
 *   dsh-sealed-files-decide --state-dir DIR --event < event.json
 *
 * With --event it reads what a dsh-cron-jobs command job gets on stdin
 * ({"events": [{"data": {...}}]}) and takes each event's data:
 * { "choice": "yes"|"no", "person", "payload": { "device", "code" }, "by" }.
 * The plugin applies a decision only while that device is pending with that code.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const value = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1] }
const stateDir = value('--state-dir')
if (!stateDir) {
  console.error('usage: dsh-sealed-files-decide --state-dir DIR (--device ID --code CODE --yes|--no | --event < event.json)')
  process.exit(2)
}
const dir = join(resolve(stateDir.replace(/^~(?=$|\/)/, homedir())), 'decisions')

let decisions
if (args.includes('--event')) {
  const document = JSON.parse(readFileSync(0, 'utf8'))
  const events = Array.isArray(document.events) ? document.events : [document]
  decisions = events.map(event => event.data ?? event).filter(Boolean).map(data => ({
    device: data.payload?.device,
    code: data.payload?.code,
    choice: data.choice,
    person: data.person,
    by: data.by,
  }))
} else {
  decisions = [{ device: value('--device'), code: value('--code'), choice: args.includes('--yes') ? 'yes' : args.includes('--no') ? 'no' : undefined, person: value('--person'), by: value('--by') }]
}

mkdirSync(dir, { recursive: true, mode: 0o700 })
let written = 0
for (const decision of decisions) {
  if (typeof decision.device !== 'string' || typeof decision.code !== 'string' || !['yes', 'no'].includes(decision.choice)) {
    console.error(`skipped: ${JSON.stringify(decision)}`)
    continue
  }
  const name = `${Date.now()}-${randomBytes(4).toString('hex')}`
  writeFileSync(join(dir, `${name}.tmp`), JSON.stringify(decision), { mode: 0o600 })
  renameSync(join(dir, `${name}.tmp`), join(dir, `${name}.json`))
  written++
}
console.log(JSON.stringify({ written }))
process.exit(written === decisions.length ? 0 : 1)
