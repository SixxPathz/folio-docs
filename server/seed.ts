import type { DB } from "./db.js";

/** Seeded accounts — auth is intentionally mocked (see ARCHITECTURE.md). */
export const SEED_USERS = [
  { id: "u_amara", email: "amara@ajaia.test", name: "Amara Okafor", color: "#D9472B" },
  { id: "u_ben", email: "ben@ajaia.test", name: "Ben Mokoena", color: "#2F5D50" },
  { id: "u_chen", email: "chen@ajaia.test", name: "Chen Liu", color: "#B7862B" },
];

const WELCOME = `<p>This draft is <strong>owned by Amara</strong> and shared with <em>Ben as an editor</em>. Log in as Ben to edit it, or as Chen to see that it is invisible to people it hasn't been shared with.</p>
<h2>What we're deciding</h2>
<ul><li><p>Which two internal tools get engineering time this quarter</p></li><li><p>Who owns the rollout for each</p></li></ul>
<h2>Next steps</h2>
<ol><li><p>Collect estimates by Friday</p></li><li><p>Review in the Monday sync</p></li></ol>`;

const NOTES = `<p>Owned by Ben, shared with Amara as a <u>viewer</u> — Amara can read but not edit.</p><ul><li><p>Panel: 3 interviewers</p></li><li><p>Take-home: 4–6 hours, timeboxed</p></li></ul>`;

export async function seed(db: DB) {
  for (const u of SEED_USERS) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO users (id, email, name, color) VALUES (?, ?, ?, ?)",
      args: [u.id, u.email, u.name, u.color],
    });
  }
  const existing = await db.execute("SELECT COUNT(*) AS n FROM documents");
  if (Number(existing.rows[0].n) > 0) return;

  const now = new Date().toISOString();
  await db.batch(
    [
      { sql: "INSERT INTO documents (id, owner_id, title, content, created_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?)", args: ["d_welcome", "u_amara", "Q4 planning brief", WELCOME, now, now, "u_amara"] },
      { sql: "INSERT INTO document_shares (document_id, user_id, role, created_at) VALUES (?,?,?,?)", args: ["d_welcome", "u_ben", "editor", now] },
      { sql: "INSERT INTO documents (id, owner_id, title, content, created_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?)", args: ["d_hiring", "u_ben", "Hiring loop notes", NOTES, now, now, "u_ben"] },
      { sql: "INSERT INTO document_shares (document_id, user_id, role, created_at) VALUES (?,?,?,?)", args: ["d_hiring", "u_amara", "viewer", now] },
    ],
    "write",
  );
}
