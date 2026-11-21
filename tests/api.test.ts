import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import type { Express } from "express";
import { openDb, migrate } from "../server/db";
import { seed } from "../server/seed";
import { createApp, errorHandler } from "../server/app";

let app: Express;

beforeEach(async () => {
  const db = openDb(":memory:");
  await migrate(db);
  await seed(db);
  app = createApp(db, { secret: "test" });
  app.use(errorHandler);
});

async function as(email: string) {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ email }).expect(200);
  return agent;
}

describe("auth", () => {
  it("rejects unauthenticated document access", async () => {
    await request(app).get("/api/documents").expect(401);
  });

  it("rejects an unknown or forged identity", async () => {
    await request(app).post("/api/auth/login").send({ email: "nobody@ajaia.test" }).expect(404);
    await request(app).get("/api/documents").set("Cookie", "folio_uid=u_amara").expect(401); // unsigned cookie
  });
});

describe("sharing & access control", () => {
  it("enforces owner / editor / viewer / no-access end to end", async () => {
    const amara = await as("amara@ajaia.test");
    const ben = await as("ben@ajaia.test");
    const chen = await as("chen@ajaia.test");

    const created = await amara.post("/api/documents").send({ title: "Launch plan" }).expect(201);
    const id = created.body.id;
    expect(created.body.role).toBe("owner");

    // Not shared yet: 404, not 403, so ids don't leak.
    await ben.get(`/api/documents/${id}`).expect(404);

    // Only the owner can share.
    await ben.post(`/api/documents/${id}/shares`).send({ email: "chen@ajaia.test", role: "editor" }).expect(404);
    await amara.post(`/api/documents/${id}/shares`).send({ email: "ben@ajaia.test", role: "viewer" }).expect(201);

    // Viewer can read but not write, and sees it under "shared".
    const asViewer = await ben.get(`/api/documents/${id}`).expect(200);
    expect(asViewer.body.role).toBe("viewer");
    await ben.patch(`/api/documents/${id}`).send({ content: "<p>hi</p>", version: 1 }).expect(403);
    const list = await ben.get("/api/documents").expect(200);
    expect(list.body.shared.map((d: { id: string }) => d.id)).toContain(id);
    expect(list.body.owned.map((d: { id: string }) => d.id)).not.toContain(id);

    // Upgrade to editor: write succeeds and is attributed to Ben.
    await amara.post(`/api/documents/${id}/shares`).send({ email: "ben@ajaia.test", role: "editor" }).expect(201);
    const saved = await ben.patch(`/api/documents/${id}`).send({ content: "<p><strong>Ben was here</strong></p>", version: 1 }).expect(200);
    expect(saved.body.content).toBe("<p><strong>Ben was here</strong></p>");
    expect(saved.body.updatedBy).toBe("Ben Mokoena");

    // Editors can't delete; outsiders still can't see it.
    await ben.delete(`/api/documents/${id}`).expect(403);
    await chen.get(`/api/documents/${id}`).expect(404);

    // Revoke: Ben loses access immediately.
    await amara.delete(`/api/documents/${id}/shares/u_ben`).expect(200);
    await ben.get(`/api/documents/${id}`).expect(404);
  });

  it("validates share requests", async () => {
    const amara = await as("amara@ajaia.test");
    const { body } = await amara.post("/api/documents").send({}).expect(201);
    await amara.post(`/api/documents/${body.id}/shares`).send({ email: "not-an-email", role: "editor" }).expect(400);
    await amara.post(`/api/documents/${body.id}/shares`).send({ email: "ghost@ajaia.test", role: "editor" }).expect(404);
    await amara.post(`/api/documents/${body.id}/shares`).send({ email: "amara@ajaia.test", role: "editor" }).expect(400);
    await amara.post(`/api/documents/${body.id}/shares`).send({ email: "ben@ajaia.test", role: "admin" }).expect(400);
  });
});

describe("saving", () => {
  it("persists formatting and rejects stale writes with 409 instead of overwriting", async () => {
    const amara = await as("amara@ajaia.test");
    const ben = await as("ben@ajaia.test"); // seeded editor on d_welcome

    const doc = (await amara.get("/api/documents/d_welcome").expect(200)).body;
    const html = "<h2>Plan</h2><ul><li><p><em>one</em></p></li></ul><p><u>two</u></p>";
    const first = await amara.patch("/api/documents/d_welcome").send({ content: html, version: doc.version }).expect(200);
    expect(first.body.version).toBe(doc.version + 1);

    // Ben still holds the old version number -> conflict, with the latest doc attached.
    const stale = await ben.patch("/api/documents/d_welcome").send({ content: "<p>overwrite</p>", version: doc.version }).expect(409);
    expect(stale.body.latest.content).toBe(html);

    // Reopen: structure survived the round trip.
    const reopened = await amara.get("/api/documents/d_welcome").expect(200);
    expect(reopened.body.content).toBe(html);
  });

  it("validates titles and strips unsafe markup", async () => {
    const amara = await as("amara@ajaia.test");
    const { body } = await amara.post("/api/documents").send({ title: "Draft" }).expect(201);
    await amara.patch(`/api/documents/${body.id}`).send({ title: "   ", version: 1 }).expect(400);
    await amara.patch(`/api/documents/${body.id}`).send({ version: 1 }).expect(400);
    const res = await amara
      .patch(`/api/documents/${body.id}`)
      .send({ content: '<p onclick="x()">ok<script>alert(1)</script><img src=x onerror=alert(1)></p>', version: 1 })
      .expect(200);
    expect(res.body.content).toBe("<p>ok</p>");
  });
});

describe("file import", () => {
  it("turns a Markdown upload into a new, owned, formatted document", async () => {
    const amara = await as("amara@ajaia.test");
    const md = "# Meeting notes\n\nWe agreed on **two** things:\n\n- ship it\n- *measure* it\n";
    const res = await amara.post("/api/documents/import").attach("file", Buffer.from(md), "notes.md").expect(201);
    expect(res.body.title).toBe("Meeting notes");
    expect(res.body.source).toBe("notes.md");
    expect(res.body.content).toContain("<strong>two</strong>");
    expect(res.body.content).toContain("<ul>");
    expect(res.body.content).not.toContain("Meeting notes"); // leading heading became the title, not a duplicate
    const list = await amara.get("/api/documents").expect(200);
    expect(list.body.owned[0].id).toBe(res.body.id);
  });

  it("converts a real .docx, keeping headings and inline formatting", async () => {
    const amara = await as("amara@ajaia.test");
    const docx = readFileSync(new URL("./fixtures/vendor-review.docx", import.meta.url));
    const res = await amara.post("/api/documents/import").attach("file", docx, "vendor-review.docx").expect(201);
    expect(res.body.title).toBe("Vendor review");
    expect(res.body.content).toContain("<strong>final</strong>");
    expect(res.body.content).toContain("<em>legal</em>");
    expect(res.body.content).toContain("<h2>Open questions</h2>");
  });

  it("imports plain text as paragraphs and rejects unsupported types", async () => {
    const amara = await as("amara@ajaia.test");
    const txt = await amara.post("/api/documents/import").attach("file", Buffer.from("Line one\n\nLine <two>"), "memo.txt").expect(201);
    expect(txt.body.title).toBe("memo");
    expect(txt.body.content).toBe("<p>Line one</p><p>Line &lt;two&gt;</p>");
    const bad = await amara.post("/api/documents/import").attach("file", Buffer.from("%PDF"), "deck.pdf").expect(415);
    expect(bad.body.error).toMatch(/\.txt, \.md or \.docx/);
  });
});
