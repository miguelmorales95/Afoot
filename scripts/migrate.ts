// Applies migration files from supabase/migrations to the database in .env.local, each in its
// own transaction (an error rolls that file back and stops). Take a backup first: npm run backup:db.
//   npm run migrate -- 20261029010000_event_links_and_feeds.sql
// Supabase doesn't record these runs; the migrations folder and git history are the record.
import "./env";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

async function main() {
  const m = (process.env.DATABASE_URL || "").match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^@:/]+):(\d+)\/([^?]+)/);
  if (!m) throw new Error("Set DATABASE_URL in .env.local");
  const files = process.argv.slice(2);
  if (!files.length) throw new Error("Name the migration files to apply");
  const client = new pg.Client({ user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5], ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations", path.basename(file)), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("commit");
        console.log(`applied ${file}`);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`${file} failed and was rolled back: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
