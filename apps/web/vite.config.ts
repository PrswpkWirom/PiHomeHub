import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendTarget =
  process.env.PIHOMEHUB_BACKEND_URL ?? "http://backend:8000";
const cacheDir = process.env.PIHOMEHUB_VITE_CACHE_DIR ?? "node_modules/.vite";

export default defineConfig({
  plugins: [react()],
  cacheDir,
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq, req) => {
            // Replace client-supplied forwarding headers with the socket peer.
            proxyReq.setHeader("X-Forwarded-For", req.socket.remoteAddress ?? "unknown");
          });
        }
      }
    }
  }
});
