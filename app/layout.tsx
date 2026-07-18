import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pagerrys Cold Room POS",
  description: "Point of sale, inventory, and profit control for Pagerrys Cold Room.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Pagerrys POS",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#152338",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
