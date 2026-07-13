/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "rgb(var(--color-app) / <alpha-value>)",
        deep: "rgb(var(--color-deep) / <alpha-value>)",
        card: "rgb(var(--color-card) / <alpha-value>)",
        raised: "rgb(var(--color-raised) / <alpha-value>)",
        line: "rgb(var(--color-line) / <alpha-value>)",
        mist: "rgb(var(--color-mist) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        "accent-focus": "rgb(var(--color-accent-focus) / <alpha-value>)",
        "accent-on-dark": "rgb(var(--color-accent-on-dark) / <alpha-value>)",
        "accent-fill": "rgb(var(--color-accent-fill) / <alpha-value>)",
        "accent-fill-focus": "rgb(var(--color-accent-fill-focus) / <alpha-value>)",
        "accent-soft": "rgb(var(--color-accent-soft) / <alpha-value>)",
        "control-line": "rgb(var(--color-control-line) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)"
      },
      fontFamily: {
        display: ["Manrope", "system-ui", "sans-serif"],
        body: ["DM Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "'SFMono-Regular'", "Consolas", "monospace"]
      },
      boxShadow: {
        panel: "var(--shadow-panel)",
        lift: "var(--shadow-lift)"
      }
    }
  },
  plugins: []
};
