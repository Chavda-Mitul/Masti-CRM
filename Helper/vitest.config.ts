import { defineConfig } from "vitest/config";

// Tests that need a page say so at the top (// @vitest-environment happy-dom). Their page is https://portal.test/login,
// and happy-dom loads nothing from the network.
export default defineConfig({
  test: {
    environment: "node",
    environmentOptions: {
      happyDOM: {
        url: "https://portal.test/login",
        settings: {
          disableIframePageLoading: true,
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
  },
});
