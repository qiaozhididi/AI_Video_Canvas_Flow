/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        canvas: {
          bg: "#0F0F14",
          panel: "#1A1A2E",
          border: "#2A2A3E",
          hover: "#252540",
        },
        neon: {
          purple: "#7C3AED",
          blue: "#3B82F6",
          cyan: "#06B6D4",
        },
        status: {
          success: "#22C55E",
          warning: "#EAB308",
          error: "#EF4444",
          running: "#8B5CF6",
        },
      },
      fontFamily: {
        display: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "PingFang SC", "sans-serif"],
        body: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "PingFang SC", "sans-serif"],
      },
      animation: {
        "pulse-neon": "pulse-neon 2s ease-in-out infinite",
        "glow": "glow 2s ease-in-out infinite alternate",
      },
      keyframes: {
        "pulse-neon": {
          "0%, 100%": { boxShadow: "0 0 5px rgba(124, 58, 237, 0.3)" },
          "50%": { boxShadow: "0 0 20px rgba(124, 58, 237, 0.6)" },
        },
        glow: {
          "0%": { boxShadow: "0 0 5px rgba(124, 58, 237, 0.2)" },
          "100%": { boxShadow: "0 0 15px rgba(124, 58, 237, 0.4)" },
        },
      },
    },
  },
  plugins: [],
};
