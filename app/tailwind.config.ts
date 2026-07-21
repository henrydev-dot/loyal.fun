import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // "Espresso ledger" palette — warm blacks, parchment text, brass accent.
        bg: "#0D0B09",
        card: "#151110",
        raise: "#1C1715",
        edge: "#2A231E",
        ink: "#EFE9DF",
        muted: "#9C917F",
        faint: "#6B6255",
        accent: "#D9A441",
        accentBright: "#E7BC63",
        champagne: "#E8CC8F",
        gain: "#7FB894",
        loss: "#D9705C",
      },
      fontFamily: {
        display: ["'Fraunces'", "Georgia", "serif"],
        body: ["'Instrument Sans'", "system-ui", "sans-serif"],
      },
      boxShadow: {
        brass: "0 0 0 1px rgba(217,164,65,0.35), 0 8px 24px -12px rgba(217,164,65,0.25)",
      },
      keyframes: {
        pop: {
          "0%": { transform: "scale(0.92)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        rise: {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        pop: "pop 0.25s ease-out",
        rise: "rise 0.35s ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
