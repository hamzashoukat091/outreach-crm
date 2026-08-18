import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        "line-soft": "rgb(var(--line-soft) / <alpha-value>)",
        // Hover weight for borders -- the base line is deliberately quiet, so
        // interactive elements need something to move to.
        "line-strong": "rgb(var(--muted) / 0.35)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        // Fill weight for solid buttons -- see --accent-solid in globals.css.
        "accent-solid": "rgb(var(--accent-solid) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      ringWidth: { 3: "3px" },
      boxShadow: {
        // Layered shadows: a tight contact shadow plus a wide ambient one.
        // A single blurred shadow is the thing that reads as "template".
        card:
          "0 1px 2px -1px rgb(var(--shadow-hue) / 0.06), 0 2px 6px -2px rgb(var(--shadow-hue) / 0.05)",
        "card-hover":
          "0 2px 4px -2px rgb(var(--shadow-hue) / 0.08), 0 12px 28px -8px rgb(var(--shadow-hue) / 0.14)",
        btn: "0 1px 2px rgb(var(--shadow-hue) / 0.06)",
        "btn-hover": "0 2px 8px -2px rgb(var(--shadow-hue) / 0.14)",
        pop: "0 16px 48px -12px rgb(var(--shadow-hue) / 0.22)",
        inset: "inset 0 1px 2px rgb(var(--shadow-hue) / 0.04)",
        glow: "0 2px 12px -2px rgb(var(--accent) / 0.45)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        // Short and ease-out: entering content should feel already-arrived.
        "fade-up": "fade-up 260ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 200ms ease-out both",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
