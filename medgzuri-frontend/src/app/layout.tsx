import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MED&გზური — სამედიცინო კვლევების ნავიგატორი",
  description:
    "მოიძიეთ სამედიცინო კვლევები, გაიარეთ სიმპტომების ანალიზი და იპოვეთ კლინიკები მთელ მსოფლიოში.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ka">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+Georgian:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
