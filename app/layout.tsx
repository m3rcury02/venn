import type { Metadata, Viewport } from "next";
import { Anton, Archivo } from "next/font/google";
import { InstallPrompt } from "@/components/install-prompt";
import { MobileNavigation } from "@/components/mobile-navigation";
import { RegisterServiceWorker } from "@/components/register-service-worker";
import "./globals.css";

// Two families, and the second one does three jobs. Archivo is variable on
// both width (62-125) and weight (100-900), so the uppercase label idiom this
// app uses ~28 times is set with `wdth 118` instead of pulling down a third
// webfont for it. Anton is display only -- it has no weight axis and no
// business below ~24px.
const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: "400",
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: "Venn",
  description: "Shared movie and TV lists for your group.",
  manifest: "/manifest.webmanifest",
  icons: {
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Venn",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${anton.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-ink">
        {/* Grain sits at z-0 and the app at z-1, so the texture never
            composites against text. See globals.css. */}
        <div className="grain-page" aria-hidden />
        {/* `black-translucent` (below) draws the app under the iOS status bar
            and home indicator; these insets are 0px everywhere else because
            `viewportFit: "cover"` above is what unlocks env(safe-area-inset-*)
            at all. */}
        <div
          className="relative z-[1] flex min-h-dvh flex-col"
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          {children}
          <MobileNavigation />
          <InstallPrompt />
        </div>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
