import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb, migrate } from "./db.js";
import { seed } from "./seed.js";
import { createApp, errorHandler } from "./app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Local convenience: load .env if present. On Render the dashboard supplies env vars
// (and real env vars always win over .env values).
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_URL ?? "file:./data/folio.db";
if (url.startsWith("file:")) fs.mkdirSync(path.join(root, "data"), { recursive: true });

const db = openDb(url);
await migrate(db);
await seed(db);

const app = createApp(db);

// Serve the built SPA in production (one service = one URL to test).
const dist = path.join(root, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => (req.method === "GET" ? res.sendFile(path.join(dist, "index.html")) : next()));
}
app.use(errorHandler);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`Folio API listening on http://localhost:${port} (db: ${url.split("?")[0]})`));
