# Submission: Folio (lightweight collaborative document editor)

**Live product:** https://folio-docs-q48q.onrender.com. On the free tier, the first load after an idle period can take about 30–50 seconds.
**Source code:** https://github.com/SixxPathz/folio-docs (also in this folder)
**Walkthrough video:** see `VIDEO_URL.txt`
**Test accounts:** no passwords. Pick a person on the sign-in page and use *Switch user* to change.
- `amara@ajaia.test`: owns *Q4 planning brief* (shared with Ben as editor)
- `ben@ajaia.test`: owns *Hiring loop notes* (shared with Amara as viewer)
- `chen@ajaia.test`: has nothing shared, so you can check that unshared docs stay hidden

## What's included

| Item | Location |
|---|---|
| Source code | `server/` (Express API), `src/` (React client), `tests/` |
| Setup and run instructions | `README.md` |
| Architecture note | `ARCHITECTURE.md` |
| AI workflow note | `AI_WORKFLOW.md` |
| Walkthrough video URL | `VIDEO_URL.txt` |
| Screenshots of the main flows | `docs/screenshots/01–08` |
| Sample files to upload (.md, .txt, .docx) | `docs/sample-files/` |
| Deployment config (Render free tier) | `render.yaml`, `.env.example` |
| Automated tests | `tests/api.test.ts` (9 tests) plus a `.docx` fixture |

## What works end to end
- **Documents:** create, rename (inline title), edit, autosave, reopen, and delete (owner only).
- **Rich text:** H1/H2/H3, bold, italic, underline, strikethrough, bulleted and numbered lists, and quotes, with keyboard shortcuts. Formatting persists across reloads.
- **File upload:** `.txt`, `.md` and `.docx` (2 MB max) can be imported as a new document or inserted into an open draft. Unsupported types get a clear error.
- **Sharing:** the owner grants access by email as **Can edit** or **View only**, and can change or revoke it. The Index separates *Your drafts* from *Shared with you*, with role tags. Viewers get a read-only editor.
- **Persistence:** libSQL/SQLite locally and Turso in production; documents, formatting and shares all survive refresh and restart.
- **Safety:** server-side access checks (404 for docs you can't see), version-based conflict detection with a keep-mine/load-theirs prompt, HTML sanitizing, validation with readable errors, and retry when offline.
- **Stretch:** role-based permissions (viewer/editor) and export to Markdown.

## What's incomplete or deliberately deprioritized
- No real-time co-editing or presence. Concurrent edits are *detected and resolved*, not merged live.
- No comments, version history, images or tables.
- Auth is mocked with seeded users (signed cookie). There's no sign-up and no invitations for people without accounts.
- `.docx` import drops images, tables and tracked changes.

## Next 2–4 hours
1. Live collaboration with Yjs over websockets, keeping the version check as a backstop.
2. Version history (snapshot per save, with preview and restore).
3. Inline comments.
4. Code-split the editor bundle, and add the Playwright walkthrough to CI.
