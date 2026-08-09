import type { Metadata } from "next";
import { Abril_Fatface, Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/**
 * Three faces, three jobs.
 *
 * Abril Fatface is the gilded transom numeral and the fat-face stock
 * certificate. It is the one loud thing in the type system and it appears only
 * on building names and house numbers — never a heading, never a label, never
 * body copy.
 *
 * Archivo is a slightly narrow American gothic drawn for small print: the
 * permit placard voice, carrying the whole interface.
 *
 * IBM Plex Mono carries every date, share count, dollar amount and job number.
 * Tabular figures genuinely read better in a compliance table, and the
 * typewriter register reinforces the ledger.
 */

const abril = Abril_Fatface({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-abril",
  display: "swap",
});

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Co-operator",
  description:
    "Compliance, records and continuity for small self-managed New York City housing co-ops.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${abril.variable} ${archivo.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
