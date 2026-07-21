/**
 * In-house icon set — 24px grid, 1.5px stroke, currentColor.
 * Hand-drawn for loyal.fun; no emoji, no icon-font dependencies.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-9.5Z" />
  </Base>
);

export const IconScan = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
    <path d="M4 12h16" />
  </Base>
);

export const IconChart = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 19V5" />
    <path d="M4 19h16" />
    <path d="m7 14 4-5 3 3 5-6" />
  </Base>
);

export const IconGift = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="9" width="16" height="4" rx="0.5" />
    <path d="M6 13v6.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V13M12 9v11.5" />
    <path d="M12 9c-4.5 0-5.5-1.8-5.5-3A2 2 0 0 1 9 4c2.2 0 3 3 3 5Zm0 0c4.5 0 5.5-1.8 5.5-3A2 2 0 0 0 15 4c-2.2 0-3 3-3 5Z" />
  </Base>
);

export const IconMedal = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="14.5" r="5" />
    <path d="m9.5 10.5-3-6.5M14.5 10.5l3-6.5M9 4h6" />
    <path d="m12 12.6.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2-1.45-1.4 2-.3.9-1.8Z" strokeWidth={1.1} />
  </Base>
);

export const IconStore = (p: IconProps) => (
  <Base {...p}>
    <path d="M4.5 9 6 4h12l1.5 5M4.5 9h15M4.5 9a2.3 2.3 0 1 0 4.6 0 2.5 2.5 0 1 0 4.9 0 2.3 2.3 0 1 0 4.6 0" />
    <path d="M5.5 11.5V20h13v-8.5M10 20v-5h4v5" />
  </Base>
);

export const IconCup = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 9h10v5a5 5 0 0 1-10 0V9Z" />
    <path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8.5 6c0-1.2 1-1.3 1-2.5M12 6c0-1.2 1-1.3 1-2.5" />
    <path d="M5 21h12" />
  </Base>
);

export const IconTicket = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 8a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2.5a1.5 1.5 0 0 0 0 3V16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2.5a1.5 1.5 0 0 0 0-3V8Z" />
    <path d="M14 7v10" strokeDasharray="2 2.4" />
  </Base>
);

export const IconFlame = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 21c-3.6 0-6-2.4-6-5.6 0-2.7 1.8-4.6 3.2-6.4C10.4 7.5 11.5 6 11.5 3.5c2.8 1.6 3.3 4.4 3 6.3 1-.3 2-1.2 2.3-2.3 1.4 1.6 2.7 3.7 2.7 6C19.5 18 16.5 21 12 21Z" />
    <path d="M12 21c-1.7 0-2.8-1.3-2.8-3 0-1.9 1.6-2.9 2.8-4.6 1.2 1.7 2.8 2.7 2.8 4.6 0 1.7-1.1 3-2.8 3Z" strokeWidth={1.2} />
  </Base>
);

export const IconExternal = (p: IconProps) => (
  <Base {...p}>
    <path d="M14 5h5v5M19 5l-8.5 8.5" />
    <path d="M19 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-11A1.5 1.5 0 0 1 6.5 6H11" />
  </Base>
);

export const IconCheck = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.5 12.2 2.4 2.4 4.6-5" />
  </Base>
);

export const IconClose = (p: IconProps) => (
  <Base {...p}>
    <path d="m7 7 10 10M17 7 7 17" />
  </Base>
);

export const IconAlert = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 4 3.5 19h17L12 4Z" />
    <path d="M12 10v4M12 16.8v.2" />
  </Base>
);

export const IconWallet = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h11A1.5 1.5 0 0 1 18 7.5V9" />
    <path d="M4 7.5V17a2 2 0 0 0 2 2h12.5a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 18.5 9H6a2 2 0 0 1-2-1.5Z" />
    <path d="M15.5 14h1" />
  </Base>
);

export const IconBolt = (p: IconProps) => (
  <Base {...p}>
    <path d="M13 3 5 13.5h5L10.5 21 19 10.5h-5L13 3Z" />
  </Base>
);

export const IconSkull = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3a7.5 7.5 0 0 0-7.5 7.5c0 2.6 1.3 4.4 3 5.6V19a1.5 1.5 0 0 0 1.5 1.5h6A1.5 1.5 0 0 0 16.5 19v-2.9c1.7-1.2 3-3 3-5.6A7.5 7.5 0 0 0 12 3Z" />
    <circle cx="9.2" cy="11" r="1.4" strokeWidth={1.2} />
    <circle cx="14.8" cy="11" r="1.4" strokeWidth={1.2} />
    <path d="M10.5 20.5v-2M13.5 20.5v-2M12 13.5l-.8 1.7h1.6L12 13.5Z" strokeWidth={1.2} />
  </Base>
);

export const IconDroplet = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3.5c3 3.8 6 7 6 10.5a6 6 0 0 1-12 0c0-3.5 3-6.7 6-10.5Z" />
    <path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5" strokeWidth={1.2} />
  </Base>
);

export const IconRocket = (p: IconProps) => (
  <Base {...p}>
    <path d="M13.5 15.5 8.5 10.5c1-3.5 3.8-6.6 8.3-7.3.9-.1 1.6.6 1.5 1.5-.7 4.5-3.8 7.3-7.3 8.3l2.5 2.5Z" />
    <path d="M8.5 10.5c-1.5-.2-3.1.3-4.3 1.5l2 1M13.5 15.5c.2 1.5-.3 3.1-1.5 4.3l-1-2" />
    <path d="M5.5 18.5c-.6.6-1.4 2-1 2 0-.4 1.4-.4 2-1" />
    <circle cx="14.5" cy="9.5" r="1.2" strokeWidth={1.2} />
  </Base>
);

export const IconReceipt = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 3.5h12V21l-2-1.4-2 1.4-2-1.4L10 21l-2-1.4L6 21V3.5Z" />
    <path d="M9 8h6M9 11.5h6M9 15h3.5" />
  </Base>
);

export const IconShield = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3.5 5 6v5.5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-2.5Z" />
    <path d="m9.3 11.8 2 2 3.4-3.8" />
  </Base>
);

export const IconArrowDown = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 4.5v15M6 13.5l6 6 6-6" />
  </Base>
);

export const IconSpinner = (p: IconProps) => (
  <Base {...p} className={`animate-spin ${p.className ?? ""}`}>
    <path d="M12 3.5A8.5 8.5 0 1 1 3.5 12" />
  </Base>
);

/** Asset roundel: ticker letters in a ring — replaces asset emoji. */
export function AssetMark({ symbol, size = 34 }: { symbol: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full border border-edge bg-bg font-display font-semibold tracking-tight text-accent"
      style={{ width: size, height: size, fontSize: size * 0.32 }}
    >
      {symbol.slice(0, 4)}
    </span>
  );
}

/** The loyal.fun mark: a cup whose steam is a rising price line. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" className="fill-card stroke-edge" />
      <path
        d="M9 15h11v4.5a5 5 0 0 1-5.5 5A5 5 0 0 1 9 19.5V15Z"
        className="stroke-accent"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M20 16.5h1.4a2.3 2.3 0 0 1 0 4.6H20"
        className="stroke-accent"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="m10.5 11 3-3.5 2.5 2L20 5.5"
        className="stroke-accent"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M20 5.5h-2.6M20 5.5v2.6" className="stroke-accent" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
