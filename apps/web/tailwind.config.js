/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "#282934",
        deep: "#1f2028",
        card: "#30313d",
        raised: "#363746",
        line: "rgba(255, 255, 255, 0.1)",
        mist: "#d7dae7",
        muted: "#9499ad",
        accent: "#3cc7c8",
        "accent-soft": "rgba(60, 199, 200, 0.14)",
        success: "#4ade80",
        warning: "#f5c15c",
        danger: "#fb7185"
      },
      fontFamily: {
        display: ["Outfit", "Aptos Display", "Segoe UI", "sans-serif"],
        body: ["Outfit", "Aptos", "Segoe UI", "sans-serif"],
        mono: ["'SFMono-Regular'", "Consolas", "'Liberation Mono'", "monospace"]
      },
      boxShadow: {
        panel: "0 22px 50px rgba(8, 10, 18, 0.24)",
        glow: "0 0 0 1px rgba(60, 199, 200, 0.22), 0 18px 44px rgba(20, 144, 146, 0.13)"
      }
    }
  },
  plugins: []
};
