import type { Metadata } from "next";
import "./globals.css";
import ServiceWorkerRegister from "./components/sw-register";

export const metadata: Metadata = {
  title: "AI News 每日文档",
  description: "AI News Daily Digest Archive",
  manifest: "/manifest.json",
  themeColor: "#2d8a5e",
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <html lang="zh-CN">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
