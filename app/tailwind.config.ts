import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // dark degen theme, but clean
        bg: "#0b0b12",
        card: "#15151f",
        edge: "#262636",
        loyal: "#a3e635", // lime — the points color
        pump: "#4ade80",
        dump: "#f87171",
        gold: "#fbbf24",
      },
      fontFamily: {
        display: ["'Space Grotesk'", "system-ui", "sans-serif"],
      },
      keyframes: {
        pop: {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "60%": { transform: "scale(1.15)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        floatUp: {
          "0%": { transform: "translateY(0)", opacity: "1" },
          "100%": { transform: "translateY(-80px)", opacity: "0" },
        },
      },
      animation: {
        pop: "pop 0.4s ease-out",
        floatUp: "floatUp 1.2s ease-out forwards",
      },
    },
  },
  plugins: [],
};
export default config;
