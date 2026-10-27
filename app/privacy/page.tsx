import type { Metadata } from "next";
import Link from "next/link";

// Plain-language privacy policy. Keep it true to the code: when a feature changes what we
// collect (sign-in, feedback, sponsors, ads, AI providers), update this page in the same
// commit. NEXT_PUBLIC_AD_PROVIDER must stay "house" (or "none"/"ethicalads"): the "adsense"
// option loads Google's tracking scripts and would make the ads section below untrue.

export const metadata: Metadata = {
  title: "Privacy — Afoot",
  description: "What Afoot collects, why, who can see it, and how to delete it.",
};

const CONTACT = "hello@somedude.app";
const EFFECTIVE = "October 27, 2026";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-20">
      <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-white/70">{children}</div>
    </section>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-fuchsia-400">{children}</ul>;
}

const Mail = () => (
  <a href={`mailto:${CONTACT}`} className="text-fuchsia-400 hover:underline">
    {CONTACT}
  </a>
);

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Privacy</h1>
      <p className="mt-2 text-sm text-white/40">Effective {EFFECTIVE}</p>

      <p className="mt-6 text-white/80">
        Afoot is made by SomeDude, an independent studio run by Miguel Morales. Afoot helps you
        find small local events. You can use it without an account. We collect as little as we
        can, and we explain all of it here.
      </p>

      <div className="mt-6 rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-fuchsia-300">The short version</h2>
        <ul className="mt-3 space-y-2 text-sm text-white/80">
          <li>✓ No account needed to browse.</li>
          <li>✓ We never sell or rent your information.</li>
          <li>✓ No ad cookies, no tracking you across sites, no ad profiles.</li>
          <li>✓ Sponsors get counts of views and clicks, never who you are.</li>
          <li>
            ✓ Questions, or want your account deleted? Email <Mail />.
          </li>
        </ul>
      </div>

      <Section id="browsing" title="When you browse">
        <List>
          <li>
            <strong className="text-white/90">Searching a place.</strong> What you type goes to our
            server. Our server asks OpenStreetMap&apos;s Nominatim service to turn it into a point on
            the map.
          </li>
          <li>
            <strong className="text-white/90">Using your location.</strong> If you tap &ldquo;use my
            current location,&rdquo; your browser asks you first. Your location is sent to our server
            to find events near you. We don&apos;t save it in our database.
          </li>
          <li>
            <strong className="text-white/90">Remembering your spot.</strong> Your browser keeps your
            last location on your own device, so Afoot opens where you left off. Clearing this
            site&apos;s data in your browser removes it.
          </li>
          <li>
            <strong className="text-white/90">Visit counts.</strong> We use Vercel Web Analytics to
            count page visits: which pages, how many visits a day, and general details like country
            and device type. It doesn&apos;t use cookies. We use the totals to improve Afoot and to
            tell sponsors roughly how many people visit.
          </li>
          <li>
            <strong className="text-white/90">Maps.</strong> The full map view loads map images
            directly from OpenFreeMap. Like any site your browser talks to, OpenFreeMap can see your
            IP address and which area of the map you load. The small street maps on event cards are
            drawn on our own server.
          </li>
          <li>
            <strong className="text-white/90">Server logs.</strong> Our host, Vercel, keeps short-term
            technical logs of requests (such as IP address and the address of the page or search
            requested). We look at them only to fix problems.
          </li>
        </List>
      </Section>

      <Section id="feedback" title="When you send feedback on an event">
        <p>
          You can report a listing, leave a heads-up (&ldquo;hard to park&rdquo;), or answer a quick
          check (&ldquo;Does this start at 8pm?&rdquo;). No account needed.
        </p>
        <List>
          <li>
            Your browser makes a random ID and keeps it on your device. Our server stores only a
            scrambled version of it (a salted hash), never the ID itself. We don&apos;t store your IP
            address with your feedback.
          </li>
          <li>
            We save what you picked, which event it was about, and any note you write (up to 500
            characters). The scrambled ID lets us count each device once and limit spam.
          </li>
          <li>
            Totals like &ldquo;Hard to park · 3&rdquo; are public. Who sent them is not.
          </li>
          <li>
            Notes are read by the Afoot admin. When we double-check a listing, your note may be
            shown to an AI model along with the event&apos;s web page. Please don&apos;t put personal
            details in notes.
          </li>
        </List>
      </Section>

      <Section id="suggest" title="When you suggest a venue">
        <p>
          The add-a-venue form asks for the venue&apos;s name, website, events page, city, a note,
          and, if you choose, your email. Only the admin sees these. We use your email only to
          reply about your suggestion.
        </p>
      </Section>

      <Section id="accounts" title="If you sign in (optional)">
        <p>
          You only need an account to say you&apos;re going, join an event chat, or swap contact
          info.
        </p>
        <List>
          <li>
            <strong className="text-white/90">Sign-in.</strong> You sign in with Google or Facebook.
            Supabase handles the sign-in for us. We receive your name, email address and profile
            picture link from them. We never see your password.
          </li>
          <li>
            <strong className="text-white/90">Your profile.</strong> A display name (you can change
            it), an optional phone number, and whether that number may be shared.
          </li>
          <li>
            <strong className="text-white/90">&ldquo;I&apos;m going.&rdquo;</strong> Going is private.
            There are no public counts or guest lists. Our server uses the number of people going
            only to help order the event list. People who are also going to the same date can see
            your display name.
          </li>
          <li>
            <strong className="text-white/90">Event chat.</strong> Only people going to that date can
            read or post. Your messages show your display name. You can block people and report
            messages.
          </li>
          <li>
            <strong className="text-white/90">Contact requests.</strong> Someone in the chat can ask
            for your contact. You approve or deny it from your inbox. They see your phone number
            only if you approve and you&apos;ve allowed sharing. It&apos;s never shown in the chat.
          </li>
          <li>
            <strong className="text-white/90">Blocks and reports</strong> are saved to keep people
            safe. The admin reviews reports.
          </li>
          <li>
            Your browser stores your sign-in session so you stay signed in. Signing out clears it.
          </li>
        </List>
      </Section>

      <Section id="sponsors" title="Sponsors and ads">
        <List>
          <li>
            Ads on Afoot are cards from local sponsors we sell ourselves, plus our own promos. We
            don&apos;t run outside ad networks. If that ever changes, we&apos;ll update this page
            before it happens.
          </li>
          <li>
            Everyone browsing an area sees the same sponsor. Your browser works out which area
            you&apos;re looking at, so your location isn&apos;t sent anywhere for ads.
          </li>
          <li>
            We count a view when a sponsor card is at least half on screen, and a click when you tap
            it. We store only daily totals for each card. No cookies, IP addresses, device IDs or
            browser details are stored for this.
          </li>
          <li>
            When you tap a sponsor card, you go to the sponsor&apos;s site with a tag saying the
            visit came from Afoot and which area. Their privacy policy applies there.
          </li>
        </List>
      </Section>

      <Section id="listings" title="Where event listings come from">
        <p>
          Listings come from venues&apos; public web pages, newsletters venues send us, and
          suggestions. We use AI to read them and pull out dates and times. This is information
          about public events, not about you.
        </p>
      </Section>

      <Section id="who" title="Who can see what">
        <List>
          <li>
            <strong className="text-white/90">Everyone:</strong> event listings, venue details, and
            heads-up totals.
          </li>
          <li>
            <strong className="text-white/90">People going to the same date:</strong> your display
            name, profile picture link, and your chat messages.
          </li>
          <li>
            <strong className="text-white/90">Someone whose request you approve:</strong> your phone
            number, if you allowed sharing.
          </li>
          <li>
            <strong className="text-white/90">The Afoot admin (Miguel):</strong> venue suggestions,
            feedback and notes, reports, and account data when needed to run Afoot, keep it safe, or
            answer your request.
          </li>
          <li>
            <strong className="text-white/90">Our service providers</strong> (below), only to do
            their job for us.
          </li>
        </List>
      </Section>

      <Section id="providers" title="Service providers">
        <List>
          <li>
            <strong className="text-white/90">Supabase</strong> — our database and sign-in.
          </li>
          <li>
            <strong className="text-white/90">Vercel</strong> — hosts the website and counts visits.
          </li>
          <li>
            <strong className="text-white/90">Google or Facebook</strong> — only if you choose to
            sign in with them.
          </li>
          <li>
            <strong className="text-white/90">OpenStreetMap Nominatim</strong> — turns a place you
            search into a map point. Our server asks, not your browser.
          </li>
          <li>
            <strong className="text-white/90">OpenFreeMap</strong> — map images.
          </li>
          <li>
            <strong className="text-white/90">Anthropic (Claude)</strong> — an AI model we may use
            to read venue pages and newsletters, and to double-check listings (which can include
            feedback notes). We also run AI on our own computer. We don&apos;t send your account
            details, phone number or chat messages to any AI.
          </li>
          <li>
            <strong className="text-white/90">Cloudflare and Resend</strong> — handle email for us.
          </li>
        </List>
      </Section>

      <Section id="never" title="What we never do">
        <List>
          <li>Sell, rent or trade your information.</li>
          <li>Share it with data brokers.</li>
          <li>Build ad profiles or track you across other sites.</li>
          <li>Show your phone number without your approval.</li>
          <li>Publish who is going to an event.</li>
        </List>
      </Section>

      <Section id="retention" title="How long we keep it">
        <List>
          <li>Your location: not saved in our database.</li>
          <li>Feedback: kept with the event listing, and deleted when the listing is deleted.</li>
          <li>Venue suggestions: kept as a record. Ask us and we&apos;ll remove your email.</li>
          <li>
            Account data: until you delete your account. RSVPs and chat for a date can disappear
            when that date&apos;s listing is updated or removed.
          </li>
          <li>Sponsor views and clicks: daily totals only.</li>
          <li>
            Backups: we keep a private weekly backup of the database. Older backups are replaced, so
            deleted data is gone from them after about two months.
          </li>
        </List>
      </Section>

      <Section id="choices" title="Your choices">
        <List>
          <li>Browse without an account, and say no when your browser asks for your location.</li>
          <li>Clear this site&apos;s data in your browser to reset your saved spot and feedback ID.</li>
          <li>Change your display name, remove your phone, or turn off sharing on your profile page.</li>
          <li>Block anyone in a chat.</li>
          <li>
            <strong className="text-white/90">Delete your account:</strong> email <Mail /> from the
            address you signed in with. We&apos;ll delete your account, profile, RSVPs, chat
            messages, contact requests and blocks, and confirm by email. Reports you filed stay, but
            no longer point to you.
          </li>
          <li>You can also ask us what we have about you, or ask us to fix it.</li>
        </List>
      </Section>

      <Section id="children" title="Children">
        <p>
          Afoot isn&apos;t meant for children under 13, and we don&apos;t knowingly collect their
          information. If you think a child has given us information, email <Mail /> and we&apos;ll
          delete it. Many events listed are for adults (21+).
        </p>
      </Section>

      <Section id="security" title="Keeping it safe">
        <p>
          Database rules limit who can read each piece of information, and phone numbers stay in
          private rows. No system is perfect, so we keep as little as we can.
        </p>
      </Section>

      <Section id="changes" title="Changes">
        <p>
          If we change this policy, we&apos;ll update this page and the date at the top. If a change
          is big, like a new kind of data or a new ad partner, we&apos;ll say so on the site first.
        </p>
      </Section>

      <Section id="contact" title="Questions">
        <p>
          Email <Mail />. It goes straight to Miguel.
        </p>
      </Section>

      <p className="mt-12 text-sm">
        <Link href="/" className="text-fuchsia-400 hover:underline">
          ← Back to events
        </Link>
      </p>
    </main>
  );
}
