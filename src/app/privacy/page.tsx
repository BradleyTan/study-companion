import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy" };

// Written by the security engineer and designer together. Keep it plain and true:
// update it whenever what we store or who processes it changes.
export default function PrivacyPage() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="inline-flex min-h-11 items-center font-bold underline-offset-4 hover:underline">← StudyNest</Link>
      <article className="sticker prose-page mt-4 p-6 sm:p-8">
        <h1 className="font-display text-4xl">How we look after your notes</h1>
        <p className="hint">Last updated 19 October 2026</p>

        <h2>What we store</h2>
        <ul>
          <li>Your email address, so you can sign in.</li>
          <li>Your subjects, notes and the lecture files you upload, plus the text we read out of those files.</li>
          <li>Your settings, like sound and theme.</li>
          <li>Your flashcards, the grades you give them when you review (to schedule the next review), and your mindmaps.</li>
          <li>Your quizzes, the answers you give (to score them and keep your list of weak topics), and your weak topics.</li>
          <li>How many AI flashcards, quizzes, mindmaps and questions you made or asked each day (for the daily limit), and a copy of what the AI sent back, so the same text never uses up your allowance twice.</li>
          <li>Your questions and the answers in &ldquo;Ask your notes&rdquo;, with the short quotes from your notes each answer cites, and any &ldquo;Not right?&rdquo; feedback you give. You can clear a subject&apos;s chat at any time; we keep at most the latest 1,000 messages per subject.</li>
          <li>A list of numbers for each passage of your notes (an &ldquo;embedding&rdquo;), so &ldquo;Ask your notes&rdquo; can find the passages that match your question. These are worked out inside Supabase, with a model that runs there; your text isn&apos;t sent to anyone else for this.</li>
          <li>Your study timer rounds: when each focus round or break started and ended, how long you focused (pauses left out), whether it ran to the end, and which subject it was for. We use them for today&apos;s rounds and this week&apos;s study time. Rounds under a minute aren&apos;t saved. The timer&apos;s settings (round lengths, auto-start, quiet mode) are saved with your other settings.</li>
          <li>Your browser keeps the running timer, and any round it couldn&apos;t save yet (for example while offline), on your device until it is saved.</li>
          <li>Your timetable: each class, study block or other slot with its subject, title, room, times, time zone, how it repeats and the weeks you skipped, and whether it came from an imported timetable file. Deleting a subject keeps its slots as &ldquo;No subject&rdquo;.</li>
          <li>If you make a calendar link: the secret part of the link, when you made it, and when a calendar last checked it. It isn&apos;t in your download, and resetting or turning off the link deletes it.</li>
        </ul>

        <h2>Where it&apos;s stored</h2>
        <p>Everything is stored with Supabase, our database and file host, encrypted at rest and sent over encrypted connections (HTTPS). The app itself runs on Vercel. StudyNest is free and runs on these services&apos; free plans.</p>

        <h2>Who can see it</h2>
        <p>Only you. Every row in our database is locked to your account, and the database itself refuses to show it to anyone else, including other students. Uploaded files sit in a private folder that only your account can open. We don&apos;t sell your data or show you ads.</p>

        <h2>AI and your notes</h2>
        <p>
          When you ask for flashcards, quizzes, mindmaps, study notes or answers from your notes, the relevant passages are sent to Groq, which runs the AI
          model (or to Cloudflare if Groq is busy). For &ldquo;Ask your notes&rdquo;, your question and the last few messages of that
          subject&apos;s chat go with them, so follow-up questions make sense. Neither keeps your text to train models; Groq may hold it for up to 30 days only to
          investigate abuse. We chose these providers because they don&apos;t use your notes for training. AI only runs when you ask for it.
        </p>
        <h2>Study notes from a web page</h2>
        <p>
          If you paste a link into &ldquo;Make study notes&rdquo;, our server opens that public page once, as StudyNest, reads its
          text and sends passages of it to the AI as above. The website sees a visit from our server, not from you. We keep only
          the notes made from it, with the link on their first line; the page itself isn&apos;t stored. Pages behind a sign-in and
          addresses inside private networks are never opened.
        </p>

        <h2>Read aloud</h2>
        <p>
          Read aloud uses the voices built into your device, so by default the text never leaves it. Some browsers also offer online
          voices; these are marked &ldquo;(online)&rdquo; in the voice list, and if you pick one your browser sends the text to its maker
          (for example Google, Microsoft or Apple) to be spoken. StudyNest never sends it anywhere for read aloud.
        </p>

        <h2>Timer notifications</h2>
        <p>
          If you turn on &ldquo;Tell me when time&apos;s up&rdquo;, your browser shows the alert itself. StudyNest doesn&apos;t use a push
          service, so nothing about your timer is sent anywhere for it. You can turn it off in Settings or in your browser at any time.
        </p>

        <h2>Timetable import and calendar link</h2>
        <p>
          An imported timetable file is read on our server to find your classes and then thrown away; we keep only the slots you add.
          We never fetch a timetable from a web address. Your calendar link lets the calendar app you add it to (Google, Apple or Outlook)
          read your timetable slots: their titles with the subject&apos;s emoji, rooms and times. Nothing else, such as notes or study
          history, is in it. Anyone who has the link can see those slots, so keep it to yourself; if it gets out, reset it in the
          timetable or in Settings and the old link stops working at once. A calendar app keeps its own copy of the slots it
          already read until you remove the calendar there; turning off or resetting the link only stops new updates.
        </p>

        <h2>Keeping it safe</h2>
        <ul>
          <li>Uploads are limited to PDF and PowerPoint files up to 25 MB, checked by their contents, not just their name.</li>
          <li>Secret keys stay on our servers and never reach your browser.</li>
          <li>Text inside uploaded files, and the questions you ask, are treated as study material, never as instructions to the AI.</li>
          <li>&ldquo;Ask your notes&rdquo; answers only from the passages of your own notes in that subject, and shows where each sentence came from.</li>
        </ul>

        <h2>Download or delete everything</h2>
        <p>
          In <Link href="/settings" className="inline-flex min-h-11 items-center">Settings</Link> you can download all your data as a file at any time, or delete your account.
          Deleting removes your account, notes and files straight away. Backups that may still hold them are erased within 30 days.
        </p>

        <h2>Contact</h2>
        <p>Questions about your data? Contact the StudyNest team through the email address you were given when you were invited to try the app.</p>
      </article>
    </main>
  );
}
