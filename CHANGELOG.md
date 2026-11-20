# Changelog

## 0.3.4

- Every change to the device list is logged in `<stateDir>/devices.jsonl` with who made it: pairing, approving and rejecting (in the panel or from outside), renaming, removing from the panel, the assistant's revoke and the sweep of stale or unused devices. Before, only decisions from outside were logged, so a device removed in the panel or swept left no trace.
- The assistant's `revoke` says so when the device doesn't exist, instead of reporting it removed.

## 0.3.3

- A device keeps its pairing on Safari and iPhone home-screen apps across reloads: it stores only its AES-GCM pair key, since WebKit loses a stored non-extractable X25519 key (an IndexedDB read gives null). Before, every reload there asked to add the device again.
- Files get their type from their name when none was stored, and saving or sharing uses it, so a phone offers the right apps (Books for an EPUB, Photos for a picture).

## 0.3.2

- Downloads, previews and saving work where the service worker can't read the device's keys (Safari, iPhone home-screen apps): the page hands the worker each file's key before using it, and the worker asks an open page when it was restarted since. Before, such a download saved the worker's error text as the file.
- A failed download or preview shows its error and is never saved or shared as the file.

## 0.3.1

- Inside DSH the panel follows the page's one change stream instead of opening its own, so it never waits for a free connection (browsers allow only a few per address over HTTP/1.1).

## 0.3.0

- Uploads keep going when you leave the panel or move around DSH: they run in a worker the DSH page keeps.
- A transfers card in the corner of every page (a strip on phones) shows uploads and downloads with progress and time left; the sidebar entry gets a progress ring.
- In Chromium browsers an upload picks itself up after a reload or a closed tab; elsewhere the card says what was sent is kept and picking the same file goes on from there. Leaving the page warns only while an upload couldn't resume by itself.

## 0.2.0

- A device already added shows a new one waiting, with its code, and approves or rejects it right there. While one waits, the Devices button turns accent with a count and the sidebar entry gets a badge, both live.
- `dsh-sealed-files-decide` takes a yes or no from outside the page (a chat button through a job, a script), applied only while the device is pending with that code. Pairing needs no model.
- The assistant's tool no longer approves devices; its answers are plain JSON again (a pending code came back undefined after approval).
- The approval dialog shows the code in full on phones.
- The version shown is read when asked, so an update in place shows at once.

## 0.1.1

- Phones save through the share sheet (the file is fetched as it opens, up to 50 MB) or the browser's own download prompt.
- The device list keeps this device first, then those waiting for approval.
- Releases skip npm when the version is already there.

## 0.1.0

First release: the Sealed Files panel (files and notes encrypted in the browser, resumable uploads, streaming previews with seeking, folders, per-person and shared spaces, devices added by pairing code), Office previews through DSH's converter, and the assistant's `sealedfiles` tool.
