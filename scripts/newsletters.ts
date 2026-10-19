// IMAP newsletter poller. Subscribe a dedicated inbox to venue newsletters,
// then run this to pull unread emails and turn them into events.
//
//   npm run newsletters            # one pass over unread mail
//   npm run newsletters -- --loop  # keep polling every 5 minutes
//
// No domain or webhook needed — just an inbox (Gmail with an app password,
// Fastmail, etc.). Set IMAP_* in .env.local. Processed mail is marked read.

import { config } from "dotenv";
config({ path: ".env.local" });

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { processInboundEmail, type InboundEmail } from "../lib/newsletter";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Set IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD in .env.local`);
    process.exit(1);
  }
  return v;
}

async function pass(): Promise<number> {
  const client = new ImapFlow({
    host: requireEnv("IMAP_HOST"),
    port: parseInt(process.env.IMAP_PORT || "993", 10),
    secure: process.env.IMAP_TLS !== "0",
    auth: { user: requireEnv("IMAP_USER"), pass: requireEnv("IMAP_PASSWORD") },
    logger: false,
  });

  let processed = 0;
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    // Only unseen messages.
    const uids = await client.search({ seen: false });
    if (!uids || uids.length === 0) {
      console.log("No new messages.");
      return 0;
    }
    console.log(`${uids.length} unread message(s).`);

    for await (const msg of client.fetch(uids, { source: true, uid: true })) {
      const parsed = await simpleParser(msg.source as Buffer);
      const fromAddr = parsed.from?.value?.[0];
      const email: InboundEmail = {
        messageId: parsed.messageId ?? null,
        from: fromAddr?.address ?? "",
        fromName: fromAddr?.name ?? null,
        to: Array.isArray(parsed.to)
          ? parsed.to[0]?.text ?? null
          : parsed.to?.text ?? null,
        subject: parsed.subject ?? null,
        text: parsed.text ?? null,
        html: typeof parsed.html === "string" ? parsed.html : null,
        receivedAt: parsed.date?.toISOString() ?? null,
      };

      if (!email.from) {
        await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
        continue;
      }

      const result = await processInboundEmail(email, (s) => console.log(s));
      if (result.status === "processed") processed++;

      // Mark read so we don't reprocess. (Unmatched mail is also marked read but
      // logged in inbound_emails with status 'unmatched' for review.)
      await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
    }
  } finally {
    lock.release();
    await client.logout();
  }
  return processed;
}

async function main() {
  const loop = process.argv.includes("--loop");
  do {
    try {
      const n = await pass();
      console.log(`Pass done: ${n} newsletter(s) produced events.`);
    } catch (err) {
      console.error("Poll failed:", (err as Error).message);
    }
    if (loop) {
      console.log("Sleeping 5 min (Ctrl+C to stop)...");
      await new Promise((r) => setTimeout(r, 300000));
    }
  } while (loop);
}

main().then(() => process.exit(0));
