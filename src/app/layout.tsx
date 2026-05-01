import type { Metadata } from "next";
import "./globals.css";

import { PageTransition } from "@/components/layout/page-transition";

export const metadata: Metadata = {
  title: "Narra Image",
  description: "潮流感生图工作台，支持内置渠道与自填 OpenAI 兼容渠道。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full bg-[var(--surface)] text-[var(--ink)]">
        <PageTransition>{children}</PageTransition>
      </body>
    </html>
  );
}
