import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist_Mono, Inter, Montserrat } from "next/font/google";
import { Navbar } from "@/components/Navbar";
import { SiteFooter } from "@/components/ui/SiteFooter";
import { ThemeScript } from "@/components/ui/ThemeScript";
import { AppOverlays } from "@/components/ui/AppOverlays";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  // Only admin tables use the mono font, so public pages do not preload it.
  preload: false,
});

export const metadata: Metadata = {
  title: { default: "Senzi", template: "%s · Senzi" },
  description: "Community forecasts on measurable startup outcomes, using virtual credits.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      data-scroll-behavior="smooth"
      lang="en"
      className={`${inter.variable} ${montserrat.variable} ${geistMono.variable} h-full antialiased`}
      // ThemeScript may add the dark class before hydration.
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">
        {/* Every sign-in passes through /onboarding, which sends people to the right home. */}
        <ClerkProvider signInFallbackRedirectUrl="/onboarding" signUpFallbackRedirectUrl="/onboarding">
          <Navbar />
          <div className="flex flex-1 flex-col">{children}</div>
          <SiteFooter />
          <AppOverlays />
        </ClerkProvider>
      </body>
    </html>
  );
}
