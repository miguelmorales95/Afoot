// Sends email through Resend (somedude.app is a verified sending domain).
export async function sendEmail(o: { to: string; subject: string; html: string; text: string; from?: string; headers?: Record<string, string> }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: o.from || process.env.FOUNDER_EMAIL_FROM || "Afoot helper <helper@somedude.app>",
      to: [o.to], subject: o.subject, html: o.html, text: o.text, ...(o.headers && { headers: o.headers }),
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => "")}`);
}
