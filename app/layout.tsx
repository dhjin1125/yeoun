import type { Metadata, Viewport } from "next";
import { Noto_Serif_KR } from "next/font/google";
import Script from "next/script";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import "./cosmic-intro.css";
import "./dream-archive-intro.css";
import { ReadingTransitionProvider } from "@/components/reading-transition-provider";

const editorial = Noto_Serif_KR({
  weight: "variable",
  display: "swap",
  preload: false,
  variable: "--font-editorial",
  fallback: ["AppleMyungjo", "Batang", "serif"]
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3010"),
  title: { default: "여운 — 마음에 남은 그 꿈, 어떤 뜻일까요?", template: "%s | 여운" },
  description: "꿈속 상징과 당신이 겪은 장면을 함께 풀어드려요. 가입 없이 핵심 해석을 무료로 읽고, 원할 때 상세 해몽과 질문 2회를 990원에 이어가세요.",
  applicationName: "여운",
  creator: "노드오프",
  publisher: "노드오프",
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "여운",
    title: "여운 — 마음에 남은 그 꿈, 어떤 뜻일까요?",
    description: "같은 꿈도 내가 한 행동과 남은 기분에 따라 달리 읽혀요. 꿈속 상징과 실제 장면을 함께 풀어보세요. 첫 해석은 가입 없이 무료예요."
  },
  twitter: { card: "summary", title: "여운 — 마음에 남은 그 꿈, 어떤 뜻일까요?", description: "꿈속 상징과 당신이 겪은 장면을 함께 풀어드려요. 가입 없이 첫 해석 무료." }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F5F6F4",
  colorScheme: "light"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" data-scroll-behavior="smooth">
      <body className={editorial.variable}>
        <a className="skip-link" href="#main-content">본문 바로가기</a>
        <ReadingTransitionProvider>{children}</ReadingTransitionProvider>
        {process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ? (
          <Script src="https://js.tosspayments.com/v2/standard" strategy="afterInteractive" />
        ) : null}
      </body>
    </html>
  );
}
