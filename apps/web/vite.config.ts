import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  build: { target: "es2022" },
  server: { port: 5199 },
});
