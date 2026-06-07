import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        studio: {
          bg: "#F2F3F0",
          sidebar: "#E7E8E5",
          ink: "#ffffff",
          panel: "#ffffff",
          panelSoft: "#F2F3F0",
          border: "#CBCCC9",
          text: "#111111",
          muted: "#666666",
          accent: "#FF8400",
          amber: "#804200",
          success: "#004D1A",
          warningBg: "#E9E3D8",
          successBg: "#DFE6E1",
          infoBg: "#DFDFE6",
          danger: "#D93C15"
        }
      }
    }
  },
  plugins: []
};

export default config;
