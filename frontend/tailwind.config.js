/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Segment 品牌绿（#52BD94 系）—— brand-* 全局生效
        brand: {
          50: "#ecfbf4", 100: "#d2f5e3", 200: "#a8ecca", 300: "#74dcac",
          400: "#52bd94", 500: "#3fa67e", 600: "#2f8767", 700: "#286b53",
          800: "#225545", 900: "#1d473a", 950: "#0a2820",
        },
        gray: {
          50: "#f9fafb", 100: "#f2f4f7", 200: "#e4e7ec", 300: "#d0d5dd",
          400: "#98a2b3", 500: "#667085", 600: "#475467", 700: "#344054",
          800: "#1d2939", 900: "#101828", 950: "#0c111d",
        },
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
      boxShadow: { card: "0 1px 3px 0 rgba(16,24,40,0.1)" },
    },
  },
  plugins: [],
};
