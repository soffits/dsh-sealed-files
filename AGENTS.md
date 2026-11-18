# dsh-sealed-files: notes for maintainers

- Layout: `index.js` (Host row: page routes, sealed API, `sealedFiles` service), `tools.js` (the `sealedfiles` tool row; looks the service up at call time so a reload of the Host row never removes the tool), `client.js` (shell half: sidebar entry, a main page framing the app), `src/` (Host modules), `web/` (the app: served as is to browsers and imported by `src/`), `locale/` (one file per language, `ui` table; no language named in code).
- `web/vendor.js`, `web/sw.js` and `dist/` are built by `npm run build` and committed. Rebuild after changing `index.js`, `tools.js`, `src/`, `web/sw-main.js` or anything it imports.
- Security-relevant rules: nothing names a file or carries text outside a sealed message; the worker serves only the inline types it lists and sandboxes them; the page's CSP allows scripts from `/sealed-files/app/` only, so no inline script or style attribute (set styles through the CSSOM).
- Tests: `npm test` (offline; age interop with typage, the service through its routes), `npm run test:browsers` (throwaway DSH home with `test/fixtures/test-identity`, Chromium; never a DSH home people use).
- Git: Conventional Commits, squash merges, PR titles are commit subjects. Releases: CHANGELOG section, version bump, merge, tag `vX.Y.Z`; `.github/workflows/publish.yml` publishes.
- Design decisions live in `docs/design.md`; replace a line when a decision changes.
