import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    // Allow the ngrok host
    allowedHosts: [
      "2d85-1-53-27-39.ngrok-free.app",
      "localhost",
      "29f9-2405-4803-c69b-4270-21fd-5310-3fd4-5916.ngrok-free.app",
    ],
    // Enable CORS for development
    cors: true,
    // Prevent HMR issues with ngrok
    hmr: {
      clientPort: 443,
    },
  },
});
