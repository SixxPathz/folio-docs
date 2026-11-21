# AI workflow note

## Tools used
- **Claude Code** (Anthropic, Claude Opus model) inside VS Code, used as a pair programmer: scaffolding, implementation, tests, and driving a headless browser to check the UI.
- **Playwright (`playwright-core` + the local Edge browser)**, scripted with AI help, for an end-to-end walkthrough and screenshots.

## Where AI materially sped things up
- **Scaffolding and wiring:** the Express routes, the libSQL schema, the typed fetch client and the TipTap toolbar took minutes instead of an hour or more.
- **The test suite:** I described the access matrix (owner/editor/viewer/outsider, revoke, conflict) and got a Supertest suite I could read and tighten.
- **CSS for a specific visual direction:** I set the direction (an editorial "broadsheet": paper, ink, one red margin rule, serif for reading, mono for metadata) and AI produced a token-based stylesheet quickly. That was much faster than hand-writing it.
- **Verification:** an AI-written browser script exercised the whole reviewer flow and captured screenshots, which I then reviewed visually.

## What I changed or rejected
- **Rejected a generic UI.** The default output of AI tools tends toward rounded cards, purple gradients and Inter. I set an explicit design direction and checked the screenshots against it.
- **Rejected real-time sync (Yjs) for this timebox.** I chose optimistic concurrency (a `version` column plus a 409 conflict prompt) so that concurrent edits are *safe* without spending the whole budget on websockets and a CRDT. This is explained in ARCHITECTURE.md.
- **Rejected plain SQLite on the free host.** Render's free disk is ephemeral, so documents would vanish after the instance restarts. I switched to libSQL so the same code runs on a local file and on free Turso.
- **Fixed an autosave bug in generated code.** The "schedule another save if edits arrived mid-save" guard checked `!timer.current`, but a cleared timeout ID is still truthy, so follow-up saves could be skipped. I reset the ID explicitly and compare against `undefined`.
- **Fixed duplicate titles on import, which I caught from a screenshot.** An imported `.md` used its first heading as the title *and* kept it in the body, so it rendered twice. Now the leading heading is moved into the title, and a test asserts it.
- **Changed status codes.** Unshared documents return **404 rather than 403**, so document IDs don't leak, and viewers get a 403 on write with a human-readable message.
- **Changed a misleading viewer status.** A read-only user saw "Saved just now". It now reads "Read-only · updated …".

## How I verified correctness, UX and reliability
1. **Automated API tests (`npm test`, 9 passing):** the access-control matrix, 409 conflicts, formatting round-trips, XSS stripping, validation errors, and `.md`/`.txt`/real `.docx` imports.
2. **Strict type-check (`npm run typecheck`)** across the client, server and tests.
3. **Scripted browser run against the production build:** sign in, create, format, autosave, reload (asserting `<strong>`, `<h2>` and `<ul>` survive), share, import, reject a `.pdf`, switch to the viewer (asserting `contenteditable="false"`), trigger and resolve a two-tab conflict, and check for no horizontal overflow at 390 px. The only console errors were the expected 401, 415 and 409 responses.
4. **Manual review of every screenshot** for hierarchy, copy and layout. That review is how the duplicate-title and viewer-status issues were found.

AI wrote a lot of the code. I made the product calls (scope cuts, the concurrency model, the storage choice, the visual direction), and nothing shipped without passing the checks above.
