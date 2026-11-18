/**
 * Decisions from outside the Web page: `<stateDir>/decisions/*.json`, one
 * `{ device, code, choice: "yes"|"no", person?, by? }` per file, written by
 * `dsh-sealed-files-decide` (bin/). The plugin takes each one as it appears,
 * applies it, logs the outcome to `decisions.jsonl` and removes the file, so a
 * decision written while DSH is down is applied when it starts.
 */
import { watch } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

export const DECISIONS = 'decisions'

export async function followDecisions({ stateDir, decide, logger }) {
  const dir = join(stateDir, DECISIONS)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  let running = Promise.resolve()

  async function take() {
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.json')).sort()) {
      const path = join(dir, name)
      let outcome
      try {
        const decision = JSON.parse(await readFile(path, 'utf8'))
        outcome = await decide(decision)
        logger.info('decision for device %s: %s', decision.device, outcome.applied ? decision.choice : outcome.reason)
        outcome = { decision, ...outcome }
      } catch (error) {
        outcome = { file: name, error: error.message }
      }
      await appendFile(join(stateDir, 'decisions.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...outcome })}\n`, { mode: 0o600 })
      await rm(path, { force: true })
    }
  }

  const kick = () => { running = running.then(take, take).catch(error => logger.warn('decisions: %s', error.message)) }
  const watcher = watch(dir, kick)
  kick()
  return async () => {
    watcher.close()
    await running
  }
}
