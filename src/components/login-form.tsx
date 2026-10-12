"use client";
import { useState, useTransition } from "react";
import { sendMagicLink, signInWithGoogle, startDemo } from "@/server/actions/auth";
import { useSound } from "./sound-provider";
import { Button } from "./ui/button";

export function LoginForm({ demo, google, initialError }: { demo: boolean; google: boolean; initialError?: string }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, start] = useTransition();
  const { play } = useSound();

  if (demo) {
    return (
      <form action={startDemo} className="flex flex-col gap-4">
        <p className="rounded-md border-2 border-ink bg-highlight p-3 text-sm on-colour">
          <strong>Demo mode.</strong> Sign-in isn&apos;t set up on this copy of the app yet. Your data lives in memory and resets when the server restarts.
        </p>
        <Button type="submit" variant="primary">Try the demo</Button>
      </form>
    );
  }

  if (sentTo) {
    return (
      <div className="flex flex-col items-start gap-3" role="status">
        <p className="text-2xl font-bold">Check your inbox ✉️</p>
        <p>We sent a sign-in link to <strong className="break-all">{sentTo}</strong>. It works once and expires in an hour.</p>
        <Button variant="ghost" onClick={() => setSentTo(null)}>Use a different email</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        noValidate className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await sendMagicLink(email);
            if (res.ok) { setSentTo(email.trim()); setError(null); play("pop"); }
            else { setError(res.error); play("boop"); }
          });
        }}
      >
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email" type="email" autoComplete="email" inputMode="email" className="input" value={email} placeholder="you@uni.ac.uk"
            onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined}
          />
        </div>
        {error && <p id="login-error" role="alert" className="error-text">{error}</p>}
        <Button type="submit" variant="primary" disabled={pending} sound={null}>{pending ? "Sending…" : "Email me a sign-in link"}</Button>
      </form>
      {google && (
        <>
          <div className="flex items-center gap-3 text-ink-soft" aria-hidden="true"><hr className="flex-1 border-ink-soft" />or<hr className="flex-1 border-ink-soft" /></div>
          <form action={signInWithGoogle}><Button type="submit" className="w-full">Continue with Google</Button></form>
        </>
      )}
    </div>
  );
}
