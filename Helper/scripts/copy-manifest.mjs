// After tsc: puts manifest.json beside the compiled files, so dist/ is the folder Chrome loads.
import { copyFileSync, existsSync } from "node:fs";

copyFileSync("manifest.json", "dist/manifest.json");
copyFileSync("popup.html", "dist/popup.html");
if (!existsSync("dist/background.js")) throw new Error("dist/background.js is missing: did tsc run?");
console.log("Built: load Helper/dist in Chrome (Extensions → Load unpacked).");
