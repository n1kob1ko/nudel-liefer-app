import "dotenv/config";

import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    /**
     * The developer's `.env` is loaded above for the database and storage URLs, but the paid
     * providers must never be called from a test: with a real `ANTHROPIC_API_KEY` the translator
     * would answer a live request and the assertions about the `FakeTranslator` would fail. Provider
     * selection is tested by passing an explicit env object (`getTranslator({ ... })`).
     */
    env: {
      DEEPL_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts", "content/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    // next-auth imports "next/server" without the extension, which Node's ESM loader rejects; let
    // Vite resolve it so the authorization matrix (NUD-093) can run the real Auth.js handlers.
    // The same for next-intl's middleware, which the proxy test (NUD-110) runs.
    server: { deps: { inline: [/next-auth/, /@auth\/core/, /next-intl/] } },
  },
});
