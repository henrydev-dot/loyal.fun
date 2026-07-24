"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChart, IconGift, IconHome, IconMedal, IconScan } from "./icons";

/**
 * Five slots with the earn action raised in the middle. Scanning is the one
 * thing a customer does standing at a counter, so it gets the thumb position
 * and a target twice the size of a tab.
 *
 * Discovery surfaces (/shops, /leaderboard) are deliberately not tabs — they
 * are reachable in one tap from Home and from any reward's shop name, which
 * keeps the bar readable at 390px.
 */
const LEFT = [
  { href: "/", label: "Home", Icon: IconHome },
  { href: "/degen", label: "Trade", Icon: IconChart },
];
const RIGHT = [
  { href: "/market", label: "Market", Icon: IconGift },
  { href: "/profile", label: "Profile", Icon: IconMedal },
];

const HIDDEN_ON = ["/merchant", "/demo-merchant"];

export default function TabBar() {
  const pathname = usePathname() ?? "/";
  if (HIDDEN_ON.some((prefix) => pathname.startsWith(prefix))) return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const tab = ({ href, label, Icon }: (typeof LEFT)[number]) => {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex-1 min-h-[56px] flex flex-col items-center justify-center gap-1
                    text-[11px] font-medium tracking-wide transition ${
                      active ? "text-accent" : "text-faint hover:text-muted"
                    }`}
      >
        <Icon size={21} strokeWidth={active ? 1.9 : 1.5} />
        {label}
      </Link>
    );
  };

  const scanActive = isActive("/scan");

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 inset-x-0 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto max-w-md bg-surface/95 backdrop-blur border-t border-edge flex items-stretch px-1">
        {LEFT.map(tab)}

        <div className="w-[72px] shrink-0 flex items-start justify-center">
          <Link
            href="/scan"
            aria-label="Scan a sale code"
            aria-current={scanActive ? "page" : undefined}
            className={`-mt-5 h-14 w-14 rounded-full flex items-center justify-center
                        border-4 border-bg transition active:scale-95 ${
                          scanActive
                            ? "bg-accentBright text-bg"
                            : "bg-accent text-bg hover:bg-accentBright shadow-brass"
                        }`}
          >
            <IconScan size={24} strokeWidth={1.9} />
          </Link>
        </div>

        {RIGHT.map(tab)}
      </div>
    </nav>
  );
}
