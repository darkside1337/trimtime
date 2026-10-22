import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const manrope = localFont({
  src: "./design-system/fonts/manrope-latin.woff2",
  variable: "--font-manrope",
  weight: "400 800",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "TrimTime",
    template: "%s · TrimTime",
  },
  description: "A friendly barber booking demo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full",
        "antialiased",
        geistMono.variable,
        inter.variable,
        manrope.variable,
        "font-sans",
      )}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
