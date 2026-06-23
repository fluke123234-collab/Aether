import type { Metadata } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const displaySerif = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Aether — A quieter place to think",
  description:
    "Aether is a calm, museum-grade sanctuary for your thoughts. Capture, recall, and reflect — in silence.",
  keywords: ["Aether", "memory", "notes", "sanctuary", "minimal", "luxury"],
  authors: [{ name: "Aether" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Aether — A quieter place to think",
    description: "A calm, museum-grade sanctuary for your thoughts.",
    siteName: "Aether",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${displaySerif.variable} antialiased bg-[#FCFBF9] text-zinc-900 dark:bg-[#09090B] dark:text-zinc-50`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
