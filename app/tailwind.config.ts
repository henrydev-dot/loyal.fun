import type { Config } from "tailwindcss";

/**
 * "Espresso ledger" — warm blacks, parchment ink, brass accent.
 *
 * Data-viz slots are separate from UI slots on purpose: chart marks have to
 * sit inside the dark-surface lightness band (OKLCH L 0.48–0.67) and clear a
 * chroma floor, which the brighter UI accent deliberately does not. The viz
 * values below were validated against the card surface (#131010) with the
 * dataviz palette checker — do not swap them for the UI tokens.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // --- surfaces, deepest to nearest ---
        bg: "#0B0908",
        surface: "#131010",
        raised: "#1A1614",
        overlay: "#221D19",
        edge: "#2A2320",
        edgeStrong: "#3B322C",

        // --- ink ---
        ink: "#F2EDE4",
        muted: "#A99C89",
        faint: "#6E6355",

        // --- brass accent (UI: text, buttons, focus) ---
        accent: "#D9A441",
        accentBright: "#EFC169",
        accentDim: "#8A6822",
        champagne: "#E8CC8F",

        // --- data-viz marks (validated for the dark card surface) ---
        gain: "#199E70",
        loss: "#E66767",
        vizBar: "#B8862C",
        vizTrack: "#2A2320",
      },
      fontFamily: {
        display: ["'Fraunces'", "Georgia", "serif"],
        body: ["'Instrument Sans'", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
      },
      boxShadow: {
        brass: "0 0 0 1px rgba(217,164,65,0.30), 0 10px 30px -16px rgba(217,164,65,0.35)",
        lift: "0 12px 32px -18px rgba(0,0,0,0.9)",
        sheet: "0 -20px 50px -24px rgba(0,0,0,0.95)",
      },
      keyframes: {
        pop: {
          "0%": { transform: "scale(0.94)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        rise: {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        sheetUp: {
          "0%": { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
        fade: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        pop: "pop 0.24s cubic-bezier(0.2,0.8,0.3,1)",
        rise: "rise 0.32s cubic-bezier(0.2,0.8,0.3,1)",
        sheetUp: "sheetUp 0.3s cubic-bezier(0.2,0.8,0.3,1)",
        fade: "fade 0.2s ease-out",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
