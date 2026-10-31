import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { Footer } from "@/components/layout/Footer";
import { SessionHeader } from "@/components/layout/SessionHeader";
import "./globals.css";

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
  title: "Tralked",
  description:
    "Notícias de games e guias de conquistas, feitos por pessoas que amam jogar.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${archivo.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <SessionHeader />
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-5 pt-6 pb-[72px]">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
