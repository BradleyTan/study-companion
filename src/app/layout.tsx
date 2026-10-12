import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Permanent_Marker } from "next/font/google";
import { SoundProvider } from "@/components/sound-provider";
import "./globals.css";

const body = Atkinson_Hyperlegible({ variable: "--font-body", subsets: ["latin"], weight: ["400", "700"] });
const marker = Permanent_Marker({ variable: "--font-marker", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: { default: "StudyNest", template: "%s · StudyNest" },
  description: "Notes, lecture files, flashcards and study plans for each of your subjects, in one place.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffdf5" },
    { media: "(prefers-color-scheme: dark)", color: "#17172a" },
  ],
  viewportFit: "cover",
};

// Applies the saved theme before first paint so there's no light/dark flash.
const themeScript = `try{var t=localStorage.getItem("studynest:theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${marker.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 btn">Skip to content</a>
        <SoundProvider>{children}</SoundProvider>
      </body>
    </html>
  );
}
