import type { ReactNode } from "react";

export const metadata = {
  title: "Car-Talk",
  description: "Evidence-first automotive review chatbot",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
