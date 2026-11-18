/**
 * Who a request belongs to. A sign-in plugin provides `requestIdentity`
 * (`current()` -> `{ provider, issuer, id, name? } | null` during one DSH
 * `/api` request); the `people` setting and `peopleFile` map its stable id to a
 * person. Nothing about who is who lives in the code.
 */
import { readFileSync, statSync } from 'node:fs'

const PERSON_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/

export const personIdOf = name => String(name).trim().toLowerCase().replace(/\s+/g, '-')

/**
 * @param {{ people: Record<string,string>, peopleFile: string, peopleKey: string }} config
 * @param {(message: string, ...args: unknown[]) => void} warn
 */
export function createPeople(config, warn) {
  let fileStamp = ''
  let fromFile = {}

  function readFile() {
    if (config.peopleFile === '') return {}
    let stamp
    try {
      const stat = statSync(config.peopleFile)
      stamp = `${stat.mtimeMs}:${stat.size}`
    } catch {
      return {}
    }
    if (stamp !== fileStamp) {
      fileStamp = stamp
      try {
        const data = JSON.parse(readFileSync(config.peopleFile, 'utf8'))
        const map = config.peopleKey === '' ? data : data?.[config.peopleKey]
        fromFile = map !== null && typeof map === 'object' ? map : {}
      } catch (error) {
        warn('people file unreadable: %s', error.message)
        fromFile = {}
      }
    }
    return fromFile
  }

  /** id -> { id, name } for every mapped sign-in. */
  function table() {
    const out = new Map()
    for (const [sub, name] of [...Object.entries(readFile()), ...Object.entries(config.people)]) {
      if (typeof name !== 'string') continue
      const id = personIdOf(name)
      if (PERSON_ID.test(id)) out.set(sub, { id, name: name.trim() })
    }
    return out
  }

  return {
    /** The person behind the current `/api` request, or null. */
    current(identityService) {
      const who = typeof identityService?.current === 'function' ? identityService.current() : null
      if (who === null || typeof who?.id !== 'string' || who.id === '') return null
      return table().get(who.id) ?? null
    },
    /** Every person, by id, with a display name. */
    all() {
      const people = new Map()
      for (const person of table().values()) if (!people.has(person.id)) people.set(person.id, person)
      return [...people.values()]
    },
  }
}
