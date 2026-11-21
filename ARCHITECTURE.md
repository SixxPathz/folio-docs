# Architecture note

## What I was optimizing for
A reviewer should be able to open one URL, sign in as two different people within a minute, and see **editing, upload, sharing and persistence work end to end**. With a 4–6 hour budget, I put the depth into the parts that make a shared editor trustworthy: correct access control, saves that don't lose work, and an editing surface that feels like a product. I kept the breadth deliberately small.

## Shape of the system

```
Browser (React + TipTap)  ──fetch /api──▶  Express (one Node process)  ──▶  libSQL / SQLite
          ▲                                     │  also serves the built SPA
          └──────────── same origin ────────────┘
```

- **One deployable service.** Express serves both the JSON API and the Vite build, so there is no CORS, the cookie is same-site, and reviewers get one URL. It deploys on Render's free tier via `render.yaml`.
- **Storage: libSQL.** The same SQL runs against a local file (dev), `:memory:` (tests) or Turso (prod, free tier). I picked it over Postgres because it costs nothing and needs no setup to run locally. I picked it over plain SQLite on the host because Render's free disk is ephemeral, and durable storage was a stated requirement.
- **Schema.** `users`, `documents(owner_id, title, content, version, updated_by, source)`, and `document_shares(document_id, user_id, role)`. Ownership is a column; sharing is a join table with a role.

## Key decisions

| Decision | Why | Tradeoff |
|---|---|---|
| **Store documents as sanitized HTML** | TipTap reads and writes it natively, imports (md/docx) produce it, and it keeps headings, marks and lists. Every write passes an allowlist sanitizer that mirrors what the editor can render, so stored content can't carry scripts. | Less structured than ProseMirror JSON for future diffing. Fine at this scope. |
| **Optimistic concurrency instead of real-time sync** | Every save sends the `version` it was based on. `UPDATE … WHERE version = ?` either succeeds or returns **409** with the latest doc, and the UI lets you keep yours or load theirs. Two people editing at once never silently lose work. | No live co-editing. A CRDT (Yjs) plus websockets was the right next step but would have consumed the whole timebox. |
| **Access checks in one function (`accessFor`)** | Each route asks for `read`, `write` or `own`. Documents you can't access return **404, not 403**, so document IDs don't leak. Viewer and editor roles are enforced on the server; the UI only reflects them. | – |
| **Mocked auth with a signed, httpOnly cookie** | The brief allows it, and it lets reviewers switch between people in one click. The cookie is HMAC-signed, so it can't be forged by editing it (covered by a test). | No passwords. In real use I'd swap this for SSO; nothing else would need to change, since routes only see `requireUser()`. |
| **Autosave (debounced 800 ms) + Ctrl/Cmd+S** | No "did I save?" anxiety. One request in flight at a time, edits made during a save are queued, network failures retry, and there's a warning on tab close while unsaved. | – |
| **Upload = convert on the server** | Use `marked` for Markdown, `mammoth` for .docx, and paragraph splitting for .txt, then sanitize. Two entry points: *Import a file* creates a new doc, and *Insert file* puts the content at the cursor in an open draft. The 2 MB limit, the extension allowlist and the error messages are all server-side. | Images and tables from .docx are dropped (documented in the UI and README). |

## What I deliberately did not build
- Real-time co-editing, presence and cursors (see the concurrency row above).
- Comments, suggestion mode and version history. Version history is cheap to add on top of the existing `version` column (an append-only `document_versions` table).
- Real authentication, invitations for people without accounts, and email notifications.
- Images and tables in the editor.
- Folders, search and trash. Delete is a hard delete, owner only, with a confirmation.

**Stretch items I did include,** because they were small and on the critical path: **role-based sharing (viewer/editor)** and **Markdown export**.

## Quality checks
- `npm test`: 9 API tests covering the whole access matrix (owner/editor/viewer/outsider, sharing, revoking), conflict detection (409), round-trip formatting persistence, XSS sanitizing, validation, and imports of `.md`, `.txt` and a real `.docx` fixture.
- `npm run typecheck`: strict TypeScript across the client, server and tests.
- A scripted browser walkthrough (Playwright driving Edge) covering the full reviewer flow, including reload persistence, the viewer being read-only, the conflict prompt, and no horizontal overflow at 390 px width. The screenshots in `docs/screenshots/` come from that run.

## With another 2–4 hours
1. **Live collaboration:** Yjs + `y-prosemirror` over a websocket, with the server persisting snapshots. The `version` check stays as a backstop.
2. **Version history:** snapshot on each save (throttled), with a side panel to preview and restore.
3. **Comments** anchored to text ranges.
4. Split the 700 kB client bundle (lazy-load the editor route) and add a Playwright test to CI.
