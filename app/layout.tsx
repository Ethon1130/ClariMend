import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "授权图片区域修复",
  description: "在浏览器本地修复已获授权图片中的小范围瑕疵",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
