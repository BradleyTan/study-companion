import type { Metadata } from "next";
import { SettingsForm } from "@/components/settings-form";
import { getRepo } from "@/server/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const profile = await (await getRepo()).getProfile();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl">Settings</h1>
      <SettingsForm profile={profile} />
    </div>
  );
}
