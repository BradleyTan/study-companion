"use client";
import { signOut } from "@/server/actions/auth";
import { Button } from "./ui/button";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="ghost" size="sm">Sign out</Button>
    </form>
  );
}
