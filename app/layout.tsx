import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegistration } from "@/app/components/ServiceWorkerRegistration";

import "./globals.css";

const description =
  "好きな気持ちを、身内だけで。招待制のプライベート推し活コミュニティ";

export const metadata: Metadata = {
  title: "推し輪",
  description,
  applicationName: "推し輪",
  manifest: "/manifest.webmanifest",
  robots: {
    index: false,
    follow: false,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "推し輪",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f15f5a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        {children}
        {/* Registered from the layout rather than from the landing screen: a
            member who opens the app at their circle would otherwise never
            register a worker, and would meet the browser's own error page
            instead of ours when something could not be reached. */}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
