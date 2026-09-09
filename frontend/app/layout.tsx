import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Institution Procurement Management",
    template: "%s · Institution Procurement",
  },
  description:
    "Paperless institutional procurement workflow — requisitions, approvals, purchase, acceptance, billing and closure.",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
