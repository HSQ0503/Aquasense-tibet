import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AquaSense | Live water readings",
  description: "Your water, measured. Live pH, ORP and temperature from your sensor station.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
