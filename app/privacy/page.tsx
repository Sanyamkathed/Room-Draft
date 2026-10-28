import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — RoomDraft",
  description: "What RoomDraft does with your photos, rooms and Pinterest data.",
};

const CONTACT = "roomdraft01@gmail.com";
const UPDATED = "28 October 2026";

/**
 * The privacy policy. Plain language, and only what the app actually does:
 * every statement here maps to code (IndexedDB storage, the /api/import
 * fetcher, the room-analysis and image-to-3D services, the Pinterest routes).
 * Change it whenever one of those changes.
 */
export default function PrivacyPage() {
  return (
    <article className="mx-auto w-[min(calc(100%-32px),760px)] py-12 md:py-16">
      <h1 className="text-display text-[clamp(40px,6vw,64px)]">Privacy</h1>
      <p className="mt-3 text-[13px] text-chalk-3">Last updated {UPDATED}</p>

      <p className="mt-8 text-[16px] leading-[1.75] text-chalk-2">
        RoomDraft lets you rebuild your room in 3D and try decor in it before you buy.
        We built it to keep your things on your own device. This page explains what
        that means, and the few times something does leave your device.
      </p>

      <Section title="Who we are">
        <p>
          RoomDraft is a 3D room planner at{" "}
          <a href="https://www.roomdraft.co" className="font-semibold text-chalk underline underline-offset-4 decoration-warm hover:text-warm">
            www.roomdraft.co
          </a>
          . This policy covers the website and the RoomDraft app it serves. For anything about
          your data, write to {CONTACT}.
        </p>
      </Section>

      <Section title="What stays on your device">
        <p>
          Your rooms, room photos, the items you make and your saved styles are stored in
          your browser&apos;s own storage on this device. We don&apos;t have accounts and we
          don&apos;t keep a copy on our servers. Clearing your browser&apos;s site data deletes
          them, and they don&apos;t follow you to another device.
        </p>
      </Section>

      <Section title="When something leaves your device">
        <ul>
          <li>
            <strong>Measuring your room.</strong> When you upload a room photo, it may be sent
            to our room-analysis service so it can find the walls and floor. The photo is
            processed and not stored.
          </li>
          <li>
            <strong>Importing a link.</strong> When you paste a link (a Pin, a shop listing or an
            image), our server fetches that page or image so it can hand the picture back to
            your browser. Nothing is kept.
          </li>
          <li>
            <strong>Exact 3D models.</strong> If you choose &ldquo;Exact 3D model&rdquo; for an
            item, its photo is sent to a free image-to-3D service hosted on Hugging Face to build
            the model. That service is run by a third party under its own terms.
          </li>
        </ul>
      </Section>

      <Section title="Pinterest">
        <p>
          Connecting Pinterest is optional. When you choose &ldquo;Connect Pinterest&rdquo;, you
          are sent to Pinterest to sign in and approve access. RoomDraft asks only for two
          read-only permissions:
        </p>
        <ul>
          <li>
            <strong>boards:read</strong>: to list your boards, so you can pick one in the Inspo feed.
          </li>
          <li>
            <strong>pins:read</strong>: to show the Pins on your boards and let you search them.
          </li>
        </ul>
        <p>
          That is all the access is used for. RoomDraft never creates, edits, deletes or posts
          anything on Pinterest, never asks for your Pinterest password, and doesn&apos;t read your
          profile, followers or analytics.
        </p>
        <p>
          <strong>What we keep.</strong> Pinterest gives us an access key, which we keep in a secure,
          http-only cookie in your browser. It expires on Pinterest&apos;s schedule (about 30 days,
          renewable for up to 60) and is deleted when you disconnect. Our server uses it only to
          fetch your boards and Pins from Pinterest when you open the feed, and passes the result
          straight to your browser. We don&apos;t save your Pins, boards or Pinterest account
          details on our servers, and we don&apos;t share them with anyone.
        </p>
        <p>
          <strong>Adding a Pin to a room.</strong> When you add a Pin to one of your rooms, its
          picture is saved with that room in your browser, like any other item you make. It
          stays on your device.
        </p>
        <p>
          <strong>Disconnecting.</strong> Use &ldquo;Disconnect Pinterest&rdquo; on the Inspo page,
          or remove RoomDraft from the connected apps in your Pinterest settings. Either one ends
          our access straight away.
        </p>
      </Section>

      <Section title="Things we don't do">
        <ul>
          <li>No analytics, advertising or tracking scripts.</li>
          <li>We don&apos;t sell or share your data.</li>
          <li>
            The newsletter form doesn&apos;t send your email anywhere yet. If that changes,
            we&apos;ll say so here first.
          </li>
        </ul>
      </Section>

      <Section title="How long things are kept">
        <ul>
          <li>Rooms and items: on your device until you delete them or clear the site&apos;s data.</li>
          <li>Pinterest access key: until it expires or you disconnect, whichever comes first.</li>
          <li>
            Our hosting provider (Vercel) keeps standard technical request logs, such as IP address
            and the page asked for, for a short time to run and secure the site. They don&apos;t
            contain your photos or Pinterest data.
          </li>
        </ul>
      </Section>

      <Section title="Children">
        <p>RoomDraft is not meant for children under 13, and we don&apos;t knowingly collect their data.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          If what RoomDraft does with data changes, we&apos;ll update this page and the date at the
          top before the change goes live.
        </p>
      </Section>

      <Section title="Questions or deletion requests">
        <p>
          Email{" "}
          <a href={`mailto:${CONTACT}`} className="font-semibold text-chalk underline underline-offset-4 decoration-warm hover:text-warm">
            {CONTACT}
          </a>
          . Because your rooms live on your device, you can delete them yourself from{" "}
          <Link href="/spaces" className="font-semibold text-chalk underline underline-offset-4 decoration-warm hover:text-warm">
            My spaces
          </Link>{" "}
          at any time.
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 border-t border-line pt-8">
      <h2 className="text-[22px] font-bold tracking-[-0.02em] text-chalk">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-[1.75] text-chalk-2 [&_li]:pl-1 [&_strong]:text-chalk [&_ul]:list-disc [&_ul]:space-y-3 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
