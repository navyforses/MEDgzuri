import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GrantKit — Find Medical & Startup Grants Worldwide",
  description:
    "Curated database of 50+ grants for medical treatment, rehabilitation, rare diseases, and startups. Updated monthly. $9/month.",
  openGraph: {
    title: "GrantKit — Find Medical & Startup Grants Worldwide",
    description:
      "Curated database of 50+ grants for medical treatment, rehabilitation, rare diseases, and startups. Updated monthly.",
    type: "website",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "GrantKit — Find Medical & Startup Grants Worldwide",
    description:
      "Curated database of 50+ grants for medical treatment, rehabilitation, rare diseases, and startups. Updated monthly.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900 antialiased">{children}</body>
    </html>
  );
}
