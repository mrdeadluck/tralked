import { Suspense } from "react";
import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { SLOGAN } from "@/components/brand/slogan";
import { Footer } from "@/components/layout/Footer";
import { LoginNotice } from "@/components/layout/LoginNotice";
import { ParallaxBackdrop } from "@/components/layout/ParallaxBackdrop";
import { SessionHeader } from "@/components/layout/SessionHeader";
import { CookieConsent } from "@/components/layout/CookieConsent";
import { RewardHost } from "@/components/fx/RewardHost";
import { env } from "@/lib/env";
import { SITE_OPEN_GRAPH } from "@/lib/seo/metadata";
import "./globals.css";
import "@/components/layout/parallax-backdrop.css";

// Archivo tem eixo de largura (wdth 62-125): os títulos usam font-stretch expandido.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  // Makes Open Graph / canonical URLs absolute (the public origin).
  metadataBase: new URL(env.APP_URL),
  title: SLOGAN,
  description:
    "Gaming Hub: notícias de games, guias de conquistas 100%, a sua biblioteca e a sua ficha de personagem.",
  openGraph: { ...SITE_OPEN_GRAPH },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${archivo.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ParallaxBackdrop />
        {/* Keyboard users skip the header (sections, search, account) in one Tab. */}
        <a
          href="#principal"
          className="sr-only z-50 rounded-[2px] bg-acc px-4 py-3 font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Pular para o conteúdo
        </a>
        <SessionHeader />
        {/* Reads the query string, so it streams outside the static shell. */}
        <Suspense fallback={null}>
          <LoginNotice />
        </Suspense>
        <main id="principal" tabIndex={-1} className="mx-auto w-full max-w-[1320px] flex-1 px-5 pt-6 pb-[72px] outline-none">
          {children}
        </main>
        <Footer />
        <CookieConsent />
        {/* XP toasts and level-up overlay for every action on the site (components/fx/reward-bus). */}
        <RewardHost />
      </body>
    </html>
  );
}
