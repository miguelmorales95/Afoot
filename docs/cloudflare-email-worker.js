// Cloudflare Email Worker — routes inbound newsletters to WhatsUp.
//
// Setup (free):
//   1. Add your domain to Cloudflare and enable Email Routing.
//   2. Create a catch-all (or a dedicated address like newsletters@yourdomain)
//      and route it to this Worker.
//   3. `npm i postal-mime` in the Worker project.
//   4. Set Worker vars: WEBHOOK_URL = https://your-app.vercel.app/api/inbound-email
//                       INBOUND_SECRET = (same as INBOUND_EMAIL_SECRET in the app)
//   5. Subscribe that address to venue newsletters.
//
// Then add sender->venue mappings so emails route to the right place:
//   npm run newsletter:add -- smog-city-torrance news@smogcitybrewing.com

import PostalMime from "postal-mime";

export default {
  async email(message, env) {
    const email = await new PostalMime().parse(message.raw);

    const payload = {
      from: email.from?.address,
      fromName: email.from?.name,
      to: message.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      messageId: email.messageId,
      receivedAt: new Date().toISOString(),
    };

    const res = await fetch(`${env.WEBHOOK_URL}?secret=${env.INBOUND_SECRET}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // Keep the message in the queue by throwing; Cloudflare will retry.
      throw new Error(`webhook ${res.status}`);
    }
  },
};
