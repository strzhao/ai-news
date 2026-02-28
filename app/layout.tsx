import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI News 每日文档",
  description: "AI News Daily Digest Archive",
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
