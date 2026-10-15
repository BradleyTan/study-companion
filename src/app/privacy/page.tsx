import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy" };

// Written by the security engineer and designer together. Keep it plain and true:
// update it whenever what we store or who processes it changes.
export default function PrivacyPage() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="font-bold underline-offset-4 hover:underline">← StudyNest</Link>
      <article className="sticker prose-page mt-4 p-6 sm:p-8">
        <h1 className="font-display text-4xl">How we look after your notes</h1>
        <p className="hint">Last updated 14 October 2026</p>

        <h2>What we store</h2>
        <ul>
          <li>Your email address, so you can sign in.</li>
          <li>Your subjects, notes and the lecture files you upload, plus the text we read out of those files.</li>
          <li>Your settings, like sound and theme.</li>
          <li>Your flashcards, the grades you give them when you review (to schedule the next review), and your mindmaps.</li>
          <li>How many AI flashcards and mindmaps you made each day (for the daily limit), and a copy of what the AI sent back, so the same text never uses up your allowance twice.</li>
          <li>Later features will add your quiz answers, study sessions and timetable. We&apos;ll update this page when they arrive.</li>
        </ul>

        <h2>Where it&apos;s stored</h2>
        <p>Everything is stored with Supabase, our database and file host, encrypted at rest and sent over encrypted connections (HTTPS). The app itself runs on Vercel. StudyNest is free and runs on these services&apos; free plans.</p>

        <h2>Who can see it</h2>
        <p>Only you. Every row in our database is locked to your account, and the database itself refuses to show it to anyone else, including other students. Uploaded files sit in a private folder that only your account can open. We don&apos;t sell your data or show you ads.</p>

        <h2>AI and your notes</h2>
        <p>
          When you ask for flashcards, quizzes, mindmaps or answers from your notes, the relevant passages are sent to Groq, which runs the AI
          model (or to Cloudflare if Groq is busy). Neither keeps your text to train models; Groq may hold it for up to 30 days only to
          investigate abuse. We chose these providers because they don&apos;t use your notes for training. AI only runs when you ask for it.
        </p>
        <h2>Read aloud</h2>
        <p>
          Read aloud uses the voices built into your device, so by default the text never leaves it. Some browsers also offer online
          voices; these are marked &ldquo;(online)&rdquo; in the voice list, and if you pick one your browser sends the text to its maker
          (for example Google, Microsoft or Apple) to be spoken. StudyNest never sends it anywhere for read aloud.
        </p>

        <h2>Keeping it safe</h2>
        <ul>
          <li>Uploads are limited to PDF and PowerPoint files up to 25 MB, checked by their contents, not just their name.</li>
          <li>Secret keys stay on our servers and never reach your browser.</li>
          <li>Text inside uploaded files is treated as study material, never as instructions to the AI.</li>
        </ul>

        <h2>Download or delete everything</h2>
        <p>
          In <Link href="/settings">Settings</Link> you can download all your data as a file at any time, or delete your account.
          Deleting removes your account, notes and files straight away. Backups that may still hold them are erased within 30 days.
        </p>

        <h2>Contact</h2>
        <p>Questions about your data? Contact the StudyNest team through the email address you were given when you were invited to try the app.</p>
      </article>
    </main>
  );
}
