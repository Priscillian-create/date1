import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pagerry Froozens POS",
  description: "Point of sale, inventory, and profit control for Pagerry Froozens.",
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
