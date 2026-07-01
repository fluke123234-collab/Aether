import type { Metadata } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const displaySerif = Instrument_Serif({ variable: "--font-display", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "Aether — A quieter place to think",
  description: "Aether is a calm, museum-grade sanctuary for your thoughts. Capture, recall, and reflect — in silence.",
  keywords: ["Aether", "memory", "notes", "sanctuary", "minimal", "luxury"],
  authors: [{ name: "Aether" }],
  icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
  manifest: "/manifest.json",
  openGraph: { title: "Aether — A quieter place to think", description: "A calm, museum-grade sanctuary for your thoughts.", siteName: "Aether", type: "website", images: ["/icon.svg"] },
  twitter: { card: "summary", title: "Aether — A quieter place to think", description: "A calm, museum-grade sanctuary for your thoughts.", images: ["/icon.svg"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('aether-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();` }} />
      </head>
      <body className={`${geistSans.variable} ${displaySerif.variable} antialiased bg-[#FCFBF9] text-zinc-900 dark:bg-[#09090B] dark:text-zinc-50`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
