import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import type { DB } from "./db.js";
import { cleanHtml, fileToHtml, MAX_UPLOAD_BYTES, splitImportTitle, UnsupportedFileError } from "./content.js";

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export type Role = "owner" | "editor" | "viewer";
type User = { id: string; email: string; name: string; color: string };

const COOKIE = "folio_uid";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

const titleSchema = z.string().trim().min(1, "Title can't be empty").max(120, "Title is too long (120 max)");
const createSchema = z.object({ title: titleSchema.optional(), content: z.string().max(1_000_000).optional() });
const patchSchema = z
  .object({
    title: titleSchema.optional(),
    content: z.string().max(1_000_000, "Document is too large").optional(),
    version: z.number().int().positive(),
  })
  .refine((b) => b.title !== undefined || b.content !== undefined, "Nothing to update");
const shareSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: z.enum(["viewer", "editor"]),
});

export function createApp(db: DB, opts: { secret?: string } = {}) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser(opts.secret ?? process.env.SESSION_SECRET ?? "folio-dev-secret"));

  // ---------- helpers ----------
  async function userById(id: string): Promise<User | null> {
    const r = await db.execute({ sql: "SELECT id, email, name, color FROM users WHERE id = ?", args: [id] });
    return (r.rows[0] as unknown as User) ?? null;
  }

  async function requireUser(req: Request): Promise<User> {
    const id = req.signedCookies?.[COOKIE];
    const user = typeof id === "string" ? await userById(id) : null;
    if (!user) throw new HttpError(401, "Sign in to continue");
    return user;
  }

  /** The single source of truth for document access. */
  async function accessFor(docId: string, userId: string): Promise<Role | null> {
    const r = await db.execute({
      sql: `SELECT d.owner_id, s.role FROM documents d
            LEFT JOIN document_shares s ON s.document_id = d.id AND s.user_id = ?
            WHERE d.id = ?`,
      args: [userId, docId],
    });
    const row = r.rows[0];
    if (!row) return null;
    if (row.owner_id === userId) return "owner";
    return (row.role as Role | null) ?? null;
  }

  /** 404 (not 403) when you have no access at all, so doc ids don't leak. */
  async function requireAccess(docId: string, userId: string, need: "read" | "write" | "own"): Promise<Role> {
    const role = await accessFor(docId, userId);
    if (!role) throw new HttpError(404, "Document not found");
    if (need === "write" && role === "viewer") throw new HttpError(403, "You have view-only access to this document");
    if (need === "own" && role !== "owner") throw new HttpError(403, "Only the owner can do that");
    return role;
  }

  async function loadDoc(docId: string) {
    const r = await db.execute({
      sql: `SELECT d.id, d.title, d.content, d.version, d.source, d.created_at, d.updated_at,
                   d.owner_id, o.name AS owner_name, o.email AS owner_email, o.color AS owner_color,
                   u.name AS updated_by_name
            FROM documents d JOIN users o ON o.id = d.owner_id
            LEFT JOIN users u ON u.id = d.updated_by
            WHERE d.id = ?`,
      args: [docId],
    });
    const d = r.rows[0];
    if (!d) throw new HttpError(404, "Document not found");
    const shares = await db.execute({
      sql: `SELECT u.id, u.name, u.email, u.color, s.role FROM document_shares s
            JOIN users u ON u.id = s.user_id WHERE s.document_id = ? ORDER BY s.created_at`,
      args: [docId],
    });
    return {
      id: d.id as string,
      title: d.title as string,
      content: d.content as string,
      version: Number(d.version),
      source: (d.source as string | null) ?? null,
      createdAt: d.created_at as string,
      updatedAt: d.updated_at as string,
      updatedBy: (d.updated_by_name as string | null) ?? null,
      owner: { id: d.owner_id, name: d.owner_name, email: d.owner_email, color: d.owner_color },
      shares: shares.rows.map((s) => ({ id: s.id, name: s.name, email: s.email, color: s.color, role: s.role })),
    };
  }

  async function insertDoc(ownerId: string, title: string, content: string, source: string | null = null) {
    const id = randomUUID();
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO documents (id, owner_id, title, content, source, created_at, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, ownerId, title, cleanHtml(content), source, now, now, ownerId],
    });
    return id;
  }

  const param = (req: Request, key: string) => String(req.params[key]);

  // ---------- auth (mocked: pick a seeded account) ----------
  app.get("/api/users", async (_req, res) => {
    const r = await db.execute("SELECT id, email, name, color FROM users ORDER BY name");
    res.json(r.rows);
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(req.body);
    const r = await db.execute({ sql: "SELECT id, email, name, color FROM users WHERE email = ?", args: [email] });
    const user = r.rows[0];
    if (!user) throw new HttpError(404, "No account with that email");
    res.cookie(COOKIE, user.id, {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });
    res.json(user);
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(COOKIE);
    res.status(204).end();
  });

  app.get("/api/auth/me", async (req, res) => {
    res.json(await requireUser(req));
  });

  // ---------- documents ----------
  app.get("/api/documents", async (req, res) => {
    const me = await requireUser(req);
    const owned = await db.execute({
      sql: `SELECT d.id, d.title, d.updated_at, d.source, u.name AS updated_by,
                   (SELECT COUNT(*) FROM document_shares s WHERE s.document_id = d.id) AS share_count
            FROM documents d LEFT JOIN users u ON u.id = d.updated_by
            WHERE d.owner_id = ? ORDER BY d.updated_at DESC`,
      args: [me.id],
    });
    const shared = await db.execute({
      sql: `SELECT d.id, d.title, d.updated_at, d.source, s.role, o.name AS owner_name, o.color AS owner_color,
                   u.name AS updated_by
            FROM document_shares s JOIN documents d ON d.id = s.document_id
            JOIN users o ON o.id = d.owner_id LEFT JOIN users u ON u.id = d.updated_by
            WHERE s.user_id = ? ORDER BY d.updated_at DESC`,
      args: [me.id],
    });
    res.json({
      owned: owned.rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at, updatedBy: r.updated_by, source: r.source, shareCount: Number(r.share_count) })),
      shared: shared.rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at, updatedBy: r.updated_by, source: r.source, role: r.role, owner: { name: r.owner_name, color: r.owner_color } })),
    });
  });

  app.post("/api/documents", async (req, res) => {
    const me = await requireUser(req);
    const body = createSchema.parse(req.body ?? {});
    const id = await insertDoc(me.id, body.title ?? "Untitled draft", body.content ?? "");
    res.status(201).json({ ...(await loadDoc(id)), role: "owner" });
  });

  /** Upload a .txt/.md/.docx and turn it into a new editable document. */
  app.post("/api/documents/import", upload.single("file"), async (req, res) => {
    const me = await requireUser(req);
    if (!req.file) throw new HttpError(400, "Attach a file in the `file` field");
    const name = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const converted = await fileToHtml(name, req.file.buffer);
    if (!converted) throw new HttpError(422, "That file has no readable text");
    const { title, html } = splitImportTitle(name, converted);
    const id = await insertDoc(me.id, title, html, name);
    res.status(201).json({ ...(await loadDoc(id)), role: "owner" });
  });

  /** Convert a file to HTML without creating a doc — used for "Insert file" into an open draft. */
  app.post("/api/convert", upload.single("file"), async (req, res) => {
    await requireUser(req);
    if (!req.file) throw new HttpError(400, "Attach a file in the `file` field");
    const name = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    res.json({ html: await fileToHtml(name, req.file.buffer) });
  });

  app.get("/api/documents/:id", async (req, res) => {
    const me = await requireUser(req);
    const role = await requireAccess(param(req, "id"), me.id, "read");
    res.json({ ...(await loadDoc(param(req, "id"))), role });
  });

  /**
   * Save title and/or content. Optimistic concurrency: the client sends the version it
   * last saw; if someone else saved in between we return 409 + the latest doc instead of
   * silently overwriting their work.
   */
  app.patch("/api/documents/:id", async (req, res) => {
    const me = await requireUser(req);
    const id = param(req, "id");
    const role = await requireAccess(id, me.id, "write");
    const body = patchSchema.parse(req.body);

    const sets: string[] = [];
    const args: (string | number)[] = [];
    if (body.title !== undefined) { sets.push("title = ?"); args.push(body.title); }
    if (body.content !== undefined) { sets.push("content = ?"); args.push(cleanHtml(body.content)); }
    sets.push("version = version + 1", "updated_at = ?", "updated_by = ?");
    args.push(new Date().toISOString(), me.id, id, body.version);

    const r = await db.execute({ sql: `UPDATE documents SET ${sets.join(", ")} WHERE id = ? AND version = ?`, args });
    if (r.rowsAffected === 0) {
      const latest = await loadDoc(id);
      throw new HttpError(409, `${latest.updatedBy ?? "Someone"} saved a newer version while you were editing`, { latest: { ...latest, role } });
    }
    res.json({ ...(await loadDoc(id)), role });
  });

  app.delete("/api/documents/:id", async (req, res) => {
    const me = await requireUser(req);
    await requireAccess(param(req, "id"), me.id, "own");
    await db.batch(
      [
        { sql: "DELETE FROM document_shares WHERE document_id = ?", args: [param(req, "id")] },
        { sql: "DELETE FROM documents WHERE id = ?", args: [param(req, "id")] },
      ],
      "write",
    );
    res.status(204).end();
  });

  // ---------- sharing ----------
  app.post("/api/documents/:id/shares", async (req, res) => {
    const me = await requireUser(req);
    const id = param(req, "id");
    await requireAccess(id, me.id, "own");
    const { email, role } = shareSchema.parse(req.body);
    const r = await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [email] });
    const target = r.rows[0];
    if (!target) throw new HttpError(404, `No Folio account for ${email}`);
    if (target.id === me.id) throw new HttpError(400, "You already own this document");
    await db.execute({
      sql: `INSERT INTO document_shares (document_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`,
      args: [id, target.id as string, role, new Date().toISOString()],
    });
    res.status(201).json((await loadDoc(id)).shares);
  });

  app.delete("/api/documents/:id/shares/:userId", async (req, res) => {
    const me = await requireUser(req);
    const id = param(req, "id");
    await requireAccess(id, me.id, "own");
    await db.execute({ sql: "DELETE FROM document_shares WHERE document_id = ? AND user_id = ?", args: [id, param(req, "userId")] });
    res.json((await loadDoc(id)).shares);
  });

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found")));

  return app;
}

/** Maps every error to a JSON body the client can show directly. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err instanceof ZodError) return res.status(400).json({ error: err.issues[0]?.message ?? "Invalid request" });
  if (err instanceof UnsupportedFileError) return res.status(415).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "File is larger than 2 MB" : err.message;
    return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: msg });
  }
  if (err instanceof SyntaxError) return res.status(400).json({ error: "Malformed JSON" });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side" });
}
