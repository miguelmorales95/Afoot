// Cloudflare Email Worker: forwards each newsletter that reaches Afoot's inbox address to the
// site, unchanged (raw email). No packages, so it can be pasted into the dashboard editor.
//
// Setup (free), in the Cloudflare dashboard for somedude.app:
//   1. Workers & Pages → Create → Worker "afoot-newsletters" → Edit code → paste this file → Deploy.
//   2. That worker → Settings → Variables and Secrets:
//        WEBHOOK_URL    = https://afoot.somedude.app/api/inbound-email   (Text)
//        INBOUND_SECRET = the same value as INBOUND_EMAIL_SECRET in Vercel (Secret)
//        FORWARD_TO     = optional: a verified Email Routing destination (your own inbox) that gets
//                         any email the site couldn't take, so nothing is lost
//   3. Email → Email Routing → Routing rules → Create address: afoot-news@somedude.app,
//      action "Send to a Worker", worker "afoot-newsletters".
//   4. Subscribe that address to venue newsletters (/admin → Newsletters lists them).
//
// The site only saves each email; the daily GitHub Actions job reads the events.

export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    // Vercel accepts request bodies up to 4.5 MB; a newsletter that big is mostly images.
    if (raw.byteLength > 4_000_000) {
      console.log(`too big for the site: ${message.from}, ${raw.byteLength} bytes`);
      if (env.FORWARD_TO) await message.forward(env.FORWARD_TO);
      return;
    }
    const res = await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "message/rfc822", "x-inbound-secret": env.INBOUND_SECRET },
      body: raw,
    });
    // Never reject: a bounce would tell the venue's mailing list to drop the address.
    if (!res.ok) {
      console.log(`webhook ${res.status} for ${message.from}: ${await res.text()}`);
      if (env.FORWARD_TO) await message.forward(env.FORWARD_TO);
    }
  },
};
