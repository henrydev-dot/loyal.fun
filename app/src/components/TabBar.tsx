"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChart, IconGift, IconHome, IconMedal, IconScan } from "./icons";

const TABS = [
  { href: "/", label: "Home", Icon: IconHome },
  { href: "/scan", label: "Scan", Icon: IconScan },
  { href: "/degen", label: "Degen", Icon: IconChart },
  { href: "/market", label: "Market", Icon: IconGift },
  { href: "/profile", label: "Profile", Icon: IconMedal },
];

export default function TabBar() {
  const pathname = usePathname();
  if (pathname?.startsWith("/merchant")) return null;

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50">
      <div className="mx-auto max-w-md bg-card/95 backdrop-blur border-t border-edge flex">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 py-3 flex flex-col items-center gap-1 text-[11px] font-medium tracking-wide ${
                active ? "text-accent" : "text-faint hover:text-muted"
              }`}
            >
              <Icon size={21} strokeWidth={active ? 1.8 : 1.5} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
