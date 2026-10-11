import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { isDemoMode, supabaseConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Send yourself a new one.",
  google: "Google sign-in didn't work. Try again, or use your email.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="sticker relative w-full max-w-[420px] p-6 pt-8 sm:p-8">
        <span className="tape" aria-hidden="true" />
        <h1 className="font-display mb-5 text-4xl">Open your notebook</h1>
        {isDemoMode() || supabaseConfig() ? (
          <LoginForm demo={isDemoMode()} initialError={typeof error === "string" ? ERRORS[error] : undefined} />
        ) : (
          <p role="alert" className="error-text">Sign-in isn&apos;t set up yet. Add the Supabase settings described in the README.</p>
        )}
        <p className="hint mt-6">
          <Link href="/privacy" className="underline underline-offset-4">How we look after your notes</Link>
        </p>
      </div>
    </main>
  );
}
