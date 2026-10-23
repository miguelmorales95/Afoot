// Weekly backup of the Supabase project (the free plan keeps none): every table in the
// `afoot` and `public` schemas plus auth.users, as gzipped JSON, into
// ~/Backups/supabase-<project>/<date>/. Keeps the newest 8 backups.
//   npm run backup:db
// Restore: the schema comes from supabase/schema.sql (Afoot) and Prisma (NoBucks); load
// rows back with a short script or psql's COPY from the JSON.

import "./env";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import pg from "pg";

const KEEP = 8;
const SCHEMAS = ["afoot", "public"];

// DATABASE_URL's password may contain unescaped @ ? % $, so split it by hand.
function connConfig(): pg.ClientConfig {
  const url = process.env.DATABASE_URL || "";
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^@:/]+):(\d+)\/([^?]+)$/);
  if (!m) throw new Error("Set DATABASE_URL in .env.local (postgresql://user:password@host:5432/postgres)");
  const [, user, password, host, port, database] = m;
  return { user, password, host, port: Number(port), database, ssl: { rejectUnauthorized: false } };
}

async function main() {
  const project = (process.env.NEXT_PUBLIC_SUPABASE_URL || "supabase").replace(/^https?:\/\//, "").split(".")[0];
  const root = path.join(os.homedir(), "Backups", `supabase-${project}`);
  const dir = path.join(root, new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(os.homedir(), "Backups"), 0o700);

  const client = new pg.Client({ ...connConfig(), connectionTimeoutMillis: 20000 });
  await client.connect();
  await client.query("begin isolation level repeatable read read only"); // one consistent snapshot
  const { rows: tables } = await client.query(
    `select table_schema, table_name from information_schema.tables
     where table_type = 'BASE TABLE' and table_schema = any($1) order by 1, 2`, [SCHEMAS]);
  tables.push({ table_schema: "auth", table_name: "users" });

  const manifest: Record<string, number> = {};
  for (const { table_schema, table_name } of tables) {
    const { rows } = await client.query(`select * from "${table_schema}"."${table_name}"`);
    const file = path.join(dir, `${table_schema}.${table_name}.json.gz`);
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(rows)), { mode: 0o600 });
    manifest[`${table_schema}.${table_name}`] = rows.length;
  }
  await client.query("rollback");
  await client.end();
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ project, at: new Date().toISOString(), rows: manifest }, null, 2), { mode: 0o600 });

  // Keep the newest KEEP backups.
  const old = fs.readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(KEEP);
  for (const d of old) fs.rmSync(path.join(root, d), { recursive: true, force: true });

  const total = Object.values(manifest).reduce((a, b) => a + b, 0);
  console.log(`Backed up ${tables.length} tables (${total} rows) to ${dir}${old.length ? `; removed ${old.length} old backup(s)` : ""}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("Backup failed:", e.message); process.exit(1); });
