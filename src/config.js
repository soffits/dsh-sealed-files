import z from '@deepseek-ai/schemastery'

const GIB = 1024 ** 3

export const Config = z.object({
  stateDir: z.string().default('~/.dsh/sealed-files')
    .description('Where the encrypted files, the file list and the device list are kept.'),
  identityFile: z.string().default('')
    .description('The assistant\'s age identity (an X25519 key, AGE-SECRET-KEY-1...). Made with mode 600 on first start when missing. Empty means <stateDir>/identity.txt. Every stored file opens with `age -d -i <this file>`.'),
  people: z.dict(z.string()).default({})
    .description('Verified sign-in id (an OIDC subject) -> person id. Each person gets a space of their own; everyone shares the space `shared`.'),
  peopleFile: z.string().default('')
    .description('A JSON file with more of the same mapping (values are display names; the person id is the lower-cased name), re-read when it changes.'),
  peopleKey: z.string().default('')
    .description('The top-level key of peopleFile that holds the mapping, such as oidc_users. Empty reads the whole file as the mapping.'),
  sharedSpace: z.boolean().default(true)
    .description('Give everyone a common space besides their own.'),
  maxFileGb: z.number().min(0.001).default(4)
    .description('Largest file one upload may be, in GiB.'),
  maxStoreGb: z.number().min(0.01).default(10)
    .description('Most the stored files and unfinished uploads may take together, in GiB.'),
  minFreeGb: z.number().min(0).default(6)
    .description('An upload is refused when it would leave less free space than this on the disk of stateDir, in GiB.'),
  retentionDays: z.natural().min(1).default(30)
    .description('Files are deleted this many days after they arrive, unless pinned.'),
  snippetHours: z.natural().min(1).default(24)
    .description('Clipboard snippets (short text sent in one step) are deleted this many hours after they arrive, unless pinned.'),
  uploadDays: z.natural().min(1).default(3)
    .description('Unfinished uploads are deleted after this many days without a new part.'),
  deviceIdleDays: z.natural().min(1).default(90)
    .description('A device that has not been used for this many days is removed from the list.'),
  notifyCommand: z.array(z.string()).default([])
    .description('Program and fixed arguments run when a device asks to be added, with one line of JSON on standard input: { event, person, device: { id, name }, code }. Send the code to that person over a channel that does not pass through the web proxy, such as a chat app. Empty runs nothing.'),
  assistantName: z.string().default('')
    .description('The assistant\'s name as people know it, shown as the sender of what it puts in and on the pairing screen. Empty says "Assistant" in the viewer\'s language.'),
  label: z.string().default('')
    .description('Sidebar label. Empty uses the page\'s name in the viewer\'s language.'),
})

export const limitsOf = config => ({
  maxFileBytes: Math.floor(config.maxFileGb * GIB),
  maxStoreBytes: Math.floor(config.maxStoreGb * GIB),
  minFreeBytes: Math.floor(config.minFreeGb * GIB),
})
