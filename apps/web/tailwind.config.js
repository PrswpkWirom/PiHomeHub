/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14213d",
        clay: "#f3ede2",
        ember: "#e76f51",
        moss: "#58735c"
      },
      fontFamily: {
        display: ["Georgia", "serif"],
        body: ["'Trebuchet MS'", "sans-serif"]
      },
      boxShadow: {
        panel: "0 18px 36px rgba(20, 33, 61, 0.08)"
      }
    }
  },
  plugins: []
};
