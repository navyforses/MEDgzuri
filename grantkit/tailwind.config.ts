import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#f0f5fa",
          100: "#dae6f2",
          200: "#b8cfe6",
          300: "#8bb1d5",
          400: "#5e8fc0",
          500: "#3d6fa6",
          600: "#2d5689",
          700: "#1e3a5f",
          800: "#1a3250",
          900: "#162a42",
        },
        accent: {
          DEFAULT: "#22c55e",
          hover: "#16a34a",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
