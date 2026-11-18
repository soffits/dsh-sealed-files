# Design

## Threat model

Trusted: the DSH host (it holds the assistant's key and can read everything) and the browsers on the people's own devices. Not trusted: the network path between them, in particular a reverse proxy or CDN that terminates TLS in front of DSH.

| The proxy | Result |
|---|---|
| reads or keeps traffic | Sees ciphertext, random ids, sizes and timing; never names, types, text, keys or which operation was called. |
| changes or replays requests and answers | Refused: sealed messages are AES-GCM under a key only the device and the assistant hold, bound to a fresh nonce and a time window; age chunks are AEAD under the file key. |
| steals the sign-in cookie | Can list nothing (the file list is sealed), can download ciphertext and send parts that fail decryption. Every change needs the device's key. |
| swaps keys at enrollment | The pairing code covers both public keys as each side saw them, and is compared over a channel outside the proxy. |
| serves modified JavaScript | Not preventable by a web page. A strict CSP stops tags the proxy might inject from running; the step that closes this is shipping the same app as a browser extension. |

## Decisions

- **age as the storage format**, written by our own small module (`web/age.js`): stored files open with any age implementation, and the payload's 64 KiB STREAM chunks are independently addressable, which gives resumable uploads (the browser keeps the file key and nonce, so a part is reproduced byte for byte) and seeking. typage's public API picks its own file key and has no chunk addressing, so it is used only as a test oracle.
- **One X25519 key per device, non-extractable in Web Crypto.** Its shared secret with the assistant gives the pair key (HKDF-SHA-256 over both public keys, AES-256-GCM). One key type keeps devices simple and works in Safari 17+, Chrome 133+, Firefox 130+. No Ed25519 signatures: the pair key authenticates both directions.
- **File keys delivered sealed, not re-headed.** A device asks for an item's key; the answer is sealed under the pair key and bound to its request. Stored files stay encrypted to the assistant only.
- **Every meaningful request goes through one sealed endpoint** (`/api/sealed-files/call`), so the operation itself is hidden. Only enrollment, upload parts (ciphertext), ciphertext reads and a "something changed" stream are separate routes.
- **Upload parts are verified on arrival.** The host can unwrap the header the device sent at start, so each part's chunks are decrypted before the part counts; a broken or changed part is just sent again. Parts are written in place in a preallocated file, so finishing is a rename.
- **The app is its own document under `/sealed-files/app/`**, framed by the shell: its service worker serves only pages in its scope, it runs under its own CSP, and the same files can later run from an extension. It copies the shell's theme tokens and language.
- **Decrypted files never run as pages of this origin.** The worker only serves images, video, audio, PDF and plain text inline (with a sandbox CSP, except PDF, which browsers' viewers refuse to render sandboxed); everything else is an attachment.
- **Downloads are a navigation of a hidden frame to the worker's URL** (answered as an attachment), so the browser's own downloader takes the decrypted stream; `<a download>` to a worker-served URL is cancelled by Chromium.
- **People come from data**: the `requestIdentity` service of a sign-in plugin and a mapping file, the same shape other plugins use. Spaces derive from it.
- **Pairing needs no model.** A device already added approves a new one in its own panel (the main path). For a first device, a configured command sends the code with a yes and a no over a channel outside the web proxy, and the answer comes back as a decision file (`dsh-sealed-files-decide`), applied only while that device is pending with that code. The assistant's tool can list and remove devices but not approve them.
- **Office previews** use DSH's `officeToPdf` service when present; the PDF is stored as an item derived from the file, encrypted like any other, and removed with it.
- **Live updates** follow a Server-Sent Events stream that carries only a version number; the page then fetches the sealed list.

- **Transfers run in an engine the DSH page keeps** (`web/transfers.js`): a SharedWorker (one per browser; a dedicated worker started by the top page where SharedWorker is missing), fed over a BroadcastChannel, so an upload goes on when the person leaves the panel or moves around DSH. It holds a Web Lock while anything moves, so Chromium doesn't freeze the page, and is paced by the requests themselves, never by timers. A page holds its messages until the engine has answered once, since a BroadcastChannel drops messages sent before a listener exists.
- **Resuming after a reload or a closed tab**: where the browser gives a file handle (Chromium's file picker and drag and drop), it is kept with the resume record and the upload continues without picking the file again (asking for permission once). Safari has no handles, so there the card says plainly that what was sent is kept and picking the same file goes on from there. A warning on leaving the page shows only while an upload runs that can't pick itself up again.
- **Background Fetch is not used**: Chromium only, and it needs the bytes encrypted before the fetch starts, which means holding the whole ciphertext.
- **The transfers card is plain DOM on the page's body** (`web/card.js`, `web/card.css`), shared by the DSH page and the panel's own tab, since DSH has no slot for an overlay across pages; downloads report from the service worker on the same channel.

## Later

- The browser extension build of `web/`.
- Thumbnails for pictures and videos, made on the host and stored sealed.
- Padding sizes.
