"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/actions";

type Labels = {
  appName: string;
  navLog: string;
  navProgress: string;
  navSignOut: string;
};

export default function SiteHeader({
  signedIn,
  labels,
}: {
  signedIn: boolean;
  labels: Labels;
}) {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <span className="brand">{labels.appName}</span>
      {signedIn ? (
        <nav>
          <Link href="/log" aria-current={pathname === "/log" ? "page" : undefined}>
            {labels.navLog}
          </Link>
          <Link
            href="/progress"
            aria-current={pathname === "/progress" ? "page" : undefined}
          >
            {labels.navProgress}
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="linkish">
              {labels.navSignOut}
            </button>
          </form>
        </nav>
      ) : null}
    </header>
  );
}
