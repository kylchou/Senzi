import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist_Mono, Inter, Montserrat } from "next/font/google";
import { Navbar } from "@/components/Navbar";
import { SiteFooter } from "@/components/ui/SiteFooter";
import { ThemeScript } from "@/components/ui/ThemeScript";
import { Toaster } from "@/components/ui/Toaster";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Senzi", template: "%s · Senzi" },
  description: "Community forecasts on measurable startup outcomes, using virtual credits.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${montserrat.variable} ${geistMono.variable} h-full antialiased`}
      // ThemeScript may add the dark class before hydration.
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">
        <ClerkProvider>
          <Navbar />
          <div className="flex flex-1 flex-col">{children}</div>
          <SiteFooter />
          <Toaster />
        </ClerkProvider>
      </body>
    </html>
  );
}
