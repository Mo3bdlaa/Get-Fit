import type { Metadata, Viewport } from "next";
import "./globals.css";
import { currentUser } from "@/lib/auth/current";
import { DEFAULT_LOCALE, dir, messages } from "@/lib/i18n";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Get Fit",
  description: "Log every set. Watch the line go up.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e1116",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const locale = user?.locale ?? DEFAULT_LOCALE;
  const m = messages(locale);

  return (
    <html lang={locale} dir={dir(locale)}>
      <body>
        <SiteHeader
          signedIn={Boolean(user)}
          labels={{
            appName: m.appName,
            navLog: m.navLog,
            navProgress: m.navProgress,
            navSignOut: m.navSignOut,
          }}
        />
        <main>
          {children}
          <p className="disclaimer">{m.notMedicalAdvice}</p>
        </main>
      </body>
    </html>
  );
}
