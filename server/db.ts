import { createClient, type Client } from "@libsql/client";

/**
 * Storage: libSQL (SQLite-compatible).
 *  - Local dev:   file:./data/folio.db   (default)
 *  - Production:  libsql://<db>.turso.io  + DATABASE_AUTH_TOKEN  (Turso free tier)
 *  - Tests:       :memory:
 * Same SQL everywhere, so there is no dev/prod drift.
 */
export type DB = Client;

export function openDb(url = process.env.DATABASE_URL ?? "file:./data/folio.db"): DB {
  return createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id         TEXT PRIMARY KEY,
     email      TEXT NOT NULL UNIQUE,
     name       TEXT NOT NULL,
     color      TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS documents (
     id          TEXT PRIMARY KEY,
     owner_id    TEXT NOT NULL REFERENCES users(id),
     title       TEXT NOT NULL,
     content     TEXT NOT NULL DEFAULT '',
     version     INTEGER NOT NULL DEFAULT 1,
     source      TEXT,                       -- original filename when imported
     created_at  TEXT NOT NULL,
     updated_at  TEXT NOT NULL,
     updated_by  TEXT REFERENCES users(id)
   )`,
  `CREATE TABLE IF NOT EXISTS document_shares (
     document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     user_id     TEXT NOT NULL REFERENCES users(id),
     role        TEXT NOT NULL CHECK (role IN ('viewer','editor')),
     created_at  TEXT NOT NULL,
     PRIMARY KEY (document_id, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_docs_owner ON documents(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_shares_user ON document_shares(user_id)`,
];

export async function migrate(db: DB) {
  await db.execute("PRAGMA foreign_keys = ON");
  for (const stmt of SCHEMA) await db.execute(stmt);
}
