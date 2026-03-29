import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://medgzuri.com"),
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
      <body
        className="bg-white font-sans text-gray-900 antialiased"
      >
        <Navbar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
