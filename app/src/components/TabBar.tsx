"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/scan", label: "Scan", icon: "📷" },
  { href: "/degen", label: "Degen", icon: "🎰" },
  { href: "/market", label: "Market", icon: "🎁" },
  { href: "/profile", label: "Profile", icon: "🏅" },
];

export default function TabBar() {
  const pathname = usePathname();
  if (pathname?.startsWith("/merchant")) return null;

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50">
      <div className="mx-auto max-w-md bg-card/95 backdrop-blur border-t border-edge flex">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 py-3 flex flex-col items-center gap-0.5 text-[11px] ${
                active ? "text-loyal" : "text-zinc-500"
              }`}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
