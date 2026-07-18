import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Car-Talk — יועץ הרכב מבוסס-ביקורות",
  description: "צ׳אט ייעוץ רכב שעונה אך ורק מתוך 8 ביקורות מאושרות, עם ציטוט לכל טענה.",
};

// Hebrew UI font loaded at runtime (not via next/font) so the production build stays offline —
// CI must not make network calls. A system stack backs it up if the link is unavailable.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
