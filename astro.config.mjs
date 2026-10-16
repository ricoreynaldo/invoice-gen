import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: { port: 3090 },
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
  },
});
