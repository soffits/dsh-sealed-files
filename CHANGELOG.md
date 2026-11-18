# Changelog

## 0.2.0

- A device already added shows a new one waiting, with its code, and approves or rejects it right there.
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
