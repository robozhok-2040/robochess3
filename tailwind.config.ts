import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0F172A', // Slate 900 (Main bg)
        surface: '#1E293B',    // Slate 800 (Cards/Panels)
        primary: {
          DEFAULT: '#3B82F6', // Electric Blue
          hover: '#2563EB',
        },
        gold: '#F59E0B',      // Amber 500 (Gamification/XP)
        success: '#10B981',   // Emerald
        error: '#EF4444',     // Red
      },
    },
  },
  plugins: [],
};

export default config;

