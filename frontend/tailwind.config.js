/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#f0f3f9",
          100: "#d9e0f0",
          200: "#b3c1e0",
          300: "#8da2d1",
          400: "#6683c1",
          500: "#4064b2",
          600: "#33508e",
          700: "#263c6b",
          800: "#1a2847",
          900: "#0d1424",
        },
      },
    },
  },
  plugins: [],
};
