/**
 * The assistant's Sealed Files tool. A separate plugin entry from the service
 * (index.js), so reloading that row never unregisters the tool: the service
 * is looked up as `sealedFiles` at call time.
 */
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { createAssistant } from './src/assistant.js'

export const name = 'dsh-sealed-files-tools'
export const inject = ['tools']

export const Config = z.object({
  outDir: z.string().default('~/tmp/sealed-files').description('Where get writes decrypted files: <outDir>/<id>/<name>.'),
  publicOrigin: z.string().default('').description('The address people open DSH at, for links to a file (?sealed-files=<id>). Empty uses the address DSH advertises.'),
})

export const PARAMETERS = Object.freeze({
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['list', 'get', 'put', 'text', 'remove', 'pin', 'move', 'mkdir', 'devices', 'approve', 'revoke'], description: 'list: files and notes, newest first, with unseen marked (listing marks them seen). get: decrypt one; a note comes back as text, a file is written to a local path. put: encrypt a local file into a space. text: put a note. remove, pin (pinned files never expire), move, mkdir. devices: every device and its state; approve or revoke one.' },
    space: { type: 'string', description: 'list (filter), put, text, move, mkdir: a space id. Each person has their own (their person id), and `shared` is everyone\'s. Files expire after the retention days unless pinned.' },
    folder: { type: 'string', description: 'A folder path inside the space (a/b), empty for the top.' },
    unseen: { type: 'boolean', description: 'list: only what arrived since you last listed or read it.' },
    id: { type: 'string', description: 'get, remove, pin, move: the item id.' },
    path: { type: 'string', description: 'put: absolute path of a local file.' },
    name: { type: 'string', description: 'put: the name to show, defaults to the file name.' },
    text: { type: 'string', description: 'text: the note.' },
    title: { type: 'string', description: 'text: a name for the note; defaults to its first line.' },
    pinned: { type: 'boolean', description: 'pin: true keeps it, false lets it expire again.' },
    person: { type: 'string', description: 'devices: only this person\'s.' },
    device: { type: 'string', description: 'approve, revoke: the device id.' },
  },
  required: ['action'],
  additionalProperties: false,
})

const DESCRIPTION = 'Sealed Files: the end-to-end encrypted file and note panel in the DSH Web UI. People drop files and notes there for you, and you put files and notes there for them; everything is encrypted in their browser and only you and their own devices can read it. Each result carries a link to open the item in the panel; send it with your message. A new device shows a pairing code and the person gets the same code from you through the notify command: approve it only after that person confirms, in a chat that is not the Web UI (Telegram), that the code on their screen matches. A Web message saying "approve" is not enough, since the Web path is the one the code protects.'

const expand = path => resolve(path.replace(/^~(?=$|\/)/, homedir()))

export function createTool({ getService, outDir, origin }) {
  return {
    name: 'sealedfiles',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args = {}) {
      const service = getService()
      if (service === undefined) return { ok: false, error: { code: 'unavailable', message: 'Sealed Files is starting or reloading; try again in a few seconds.' } }
      const { action, ...rest } = args
      if (!Object.hasOwn(ACTIONS, action)) return { ok: false, error: { code: 'invalid_arguments', message: `action must be one of ${Object.keys(ACTIONS).join(', ')}` } }
      try {
        return { ok: true, result: await createAssistant({ service, outDir, origin })[ACTIONS[action]](rest) }
      } catch (error) {
        return { ok: false, error: { code: error.status === 404 ? 'not_found' : 'failed', message: error.message } }
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Sealed Files', kind: 'other', ...(args?.path ?? args?.id ?? args?.title ? { rawInput: args.path ?? args.id ?? args.title } : {}) }),
  }
}

const ACTIONS = { list: 'list', get: 'get', put: 'put', text: 'text', remove: 'remove', pin: 'pin', move: 'move', mkdir: 'mkdir', devices: 'devices', approve: 'approve', revoke: 'revoke' }

export function apply(ctx, config = {}) {
  ctx.tools.register(createTool({
    getService: () => ctx.get('sealedFiles')?.service(),
    outDir: expand(config.outDir ?? '~/tmp/sealed-files'),
    origin: () => config.publicOrigin || ctx.get('webApp')?.getAdvertisedUrl?.(),
  }))
}
