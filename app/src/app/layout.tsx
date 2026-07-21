import type { Metadata, Viewport } from "next";
import "./globals.css";
import TabBar from "@/components/TabBar";

export const metadata: Metadata = {
  title: "loyal.fun — degen loyalty",
  description:
    "Buy a coffee, earn points, long BONK with them, spend the wins on free coffee.",
  manifest: "/manifest.json",
  icons: [{ rel: "icon", url: "/icon.svg" }],
};

export const viewport: Viewport = {
  themeColor: "#0b0b12",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="mx-auto max-w-md min-h-dvh flex flex-col">
          <main className="flex-1 px-4 pt-6 pb-28">{children}</main>
          <TabBar />
        </div>
      </body>
    </html>
  );
}
