# @soffits/dsh-sealed-files

End-to-end encrypted files and notes for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). A panel in the Web UI where the people who sign in to your DSH and your assistant hand each other files and text. Everything is encrypted in the browser before it leaves the device, so a TLS-terminating proxy or CDN in front of DSH carries only ciphertext.

- Upload from any browser, phone or desktop, in resumable parts: a dropped connection, a reload or a DSH restart costs only the part in flight.
- Videos stream and seek, pictures, PDFs, audio and text open in place, all decrypted on the device as they are read. Office files get a PDF preview through DSH's own converter when it is there.
- Notes: write or paste text, copy it back out.
- A clipboard at the top of each space for short text (a link, a code, an error line): paste and send in one step, every snippet shown in full with a one-tap copy button, gone after a day unless kept.
- A small folder tree in each space. Each person has their own space, and everyone shares one.
- The assistant gets a `sealedfiles` tool: see what arrived, read it, put files, notes and clipboard snippets in, list and remove devices.
- Every stored file is a standard [age](https://age-encryption.org) file encrypted to the assistant's key: `age -d -i identity.txt items/<id>.age` opens it without this plugin.

## How the encryption works

Each browser makes its own X25519 key with Web Crypto, marked non-extractable, so it never leaves the device. The assistant has one age X25519 identity on the DSH host. When a device is added, it shows a 12-character pairing code computed from both public keys. The person compares it with the same code shown on a device they already added, or sent to them over a channel outside your web proxy, and says yes there. After that:

- Uploads are age files encrypted in the browser to the assistant's pinned key. The page cuts the payload into parts of 128 age chunks (8 MiB), each checked by the host as it arrives.
- The X25519 secret a device shares with the assistant gives one AES-256-GCM key. Every request and answer that means anything (the file list, names, file keys, folder and device changes) is sealed with it, bound to a fresh nonce, so the proxy sees neither content nor names nor which operation was asked for, and cannot forge, replay or reorder them.
- To read a file, a device gets its file key sealed for it, fetches only the ciphertext chunks it needs, and decrypts them in a service worker that answers the page's video, picture and download requests with plaintext and proper Range handling.

What the proxy still sees: sizes, timing, random ids, and that someone uses this panel. What a web page cannot defend against: a proxy that serves modified JavaScript. The page runs under a strict content security policy (only its own scripts, nothing inline), which stops injected tags from running, but the code itself still arrives through the proxy. Running the same app from a browser extension closes that gap on desktops and is planned. See [docs/design.md](docs/design.md) for the full threat model.

## Install

```sh
dsh plugin --profile web add @soffits/dsh-sealed-files
```

Then restart DSH. Without a sign-in plugin there is one owner and the panel has no people to map: install a sign-in plugin that provides the `requestIdentity` service, such as [dsh-oidc](https://github.com/soffits/dsh-oidc), and map its user ids to people.

## Configure

Override the `sealed-files` row in your profile's `cordis.patch.yml`:

```yaml
- id: sealed-files
  config:
    stateDir: ~/sealed-files
    identityFile: ~/secrets/sealed-files/identity.txt
    peopleFile: ~/people.json        # { "oidc_users": { "<sub>": "Alice", ... } }
    peopleKey: oidc_users
    notifyCommand: [/usr/local/bin/send-pairing-code]
    assistantName: Robin
    maxFileGb: 4
    maxStoreGb: 10
    minFreeGb: 6
```

| Setting | Default | Meaning |
|---|---|---|
| `stateDir` | `~/.dsh/sealed-files` | Encrypted items, unfinished uploads, the file list and the device list. |
| `identityFile` | `<stateDir>/identity.txt` | The assistant's age identity. Made with mode 600 on first start when missing. Back it up: without it nothing here can be read. |
| `people`, `peopleFile`, `peopleKey` | | Sign-in id → person. A person's id is their name in lower case; each gets a space of their own. |
| `sharedSpace` | `true` | A space everyone sees. |
| `notifyCommand` | none | Run when a device asks to be added, with one JSON line on stdin: `{ "event": "device-pending", "person", "personName", "device": { "id", "name" }, "code" }`. Send the code to that person with a yes and a no; answers come back through `dsh-sealed-files-decide`. |
| `assistantName` | | Shown as the sender of what the assistant puts in and on the pairing screen. |
| `maxFileGb`, `maxStoreGb`, `minFreeGb` | 4, 10, 6 | One upload's limit, the store's limit, and the free disk space an upload must leave. |
| `retentionDays` | 30 | Files are deleted this long after they arrive unless pinned. |
| `snippetHours` | 24 | Clipboard snippets are deleted this many hours after they arrive unless pinned. |
| `uploadDays` | 3 | Unfinished uploads are dropped after this long without a new part. |
| `deviceIdleDays` | 90 | Devices unused this long are removed. |

The tools row (`sealed-files-tools`) takes `outDir` (where `get` writes decrypted files, default `~/tmp/sealed-files`) and `publicOrigin` (the address people open DSH at, for links).

A link to `/?sealed-files=<id>` opens the panel on that item.

## Adding a device

1. Open the panel on the new device and press **Add this device**. It shows a pairing code.
2. On a device the person already added, the panel shows the new one with the same code and **Approve** / **Reject**. Approve only when the codes match.
3. For the first device, or with no other device at hand, `notifyCommand` gets the code. Send it to the person over a channel that doesn't pass through your web proxy, with a yes and a no they can answer there. Feed the answer back with `dsh-sealed-files-decide`:

   ```sh
   dsh-sealed-files-decide --state-dir ~/sealed-files --device <id> --code <code> --yes   # or --no
   dsh-sealed-files-decide --state-dir ~/sealed-files --event < event.json                # a dsh-cron-jobs command job's stdin
   ```

   It writes a decision file into `<stateDir>/decisions/`, which the plugin takes while that device is still pending with that code, also after a restart. No model is involved anywhere in pairing.

Every change to the device list (added, approved, rejected, renamed, removed from the panel, removed by the assistant, dropped as unused) is appended to `<stateDir>/devices.jsonl`, one JSON line each with the time, the device and who did it (the device it was done from, an outside decision with its `--by` label, the assistant, or the sweep with its reason). Decisions taken from outside are also logged with their outcome, applied or not, in `<stateDir>/decisions.jsonl`.

On iPhone and iPad, open DSH from the Home Screen. Safari deletes a site's storage after seven days without a visit, and with it the device key; the Home Screen app keeps its own. A device that lost its key is simply added again; no file is lost, since files are stored for the assistant, not for a device.

## Browser support

Web Crypto X25519: Safari 17, Chrome 133, Firefox 130, or newer. Service workers must be allowed (private windows may refuse them).

## Development

```sh
npm ci
npm run build     # web/vendor.js, web/sw.js and dist/, all committed
npm run check
npm test
npm run test:browsers   # a throwaway DSH home and Chromium; needs `dsh`, ffmpeg and CHROME_PATH
```

`web/` is served to browsers as it is and imported by the host code too. The age format code (`web/age.js`) is checked against [typage](https://github.com/FiloSottile/typage) both ways and against the `age` command when it is on PATH.

## Licence

MIT. Bundled: [noble-ciphers, noble-curves, noble-hashes, scure-base](https://paulmillr.com/noble/) (MIT), icon shapes from [Lucide](https://lucide.dev) (ISC).
