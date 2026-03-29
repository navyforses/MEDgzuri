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
          DEFAULT: "#1B4F72",
          hover: "#134074",
          light: "rgba(27, 79, 114, 0.08)",
          pale: "rgba(27, 79, 114, 0.15)",
        },
        accent: {
          DEFAULT: "#2ECC71",
          hover: "#27AE60",
        },
        text: {
          DEFAULT: "#1A202C",
          secondary: "rgba(26, 32, 44, 0.6)",
          muted: "rgba(26, 32, 44, 0.4)",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          alt: "#F8FAFC",
        },
        border: {
          DEFAULT: "#E2E8F0",
          light: "#F0F2F4",
        },
        success: "#10B981",
        warning: "#F59E0B",
        danger: "#EF4444",
      },
      fontFamily: {
        sans: [
          "'Source Sans 3'",
          "'Noto Sans'",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        georgian: ["'Noto Sans Georgian'", "sans-serif"],
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
        full: "9999px",
      },
      boxShadow: {
        sm: "0 1px 3px rgba(26, 32, 44, 0.06)",
        md: "0 4px 12px rgba(26, 32, 44, 0.08)",
        lg: "0 8px 30px rgba(26, 32, 44, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
