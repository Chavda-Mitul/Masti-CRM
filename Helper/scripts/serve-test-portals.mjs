// Pretend portals for trying the helper by hand (docs/decisions/0024-portal-logins.md): npm run serve:test-portals,
// then open http://localhost:5199. A login is right with the ID test-agent and the password Test-Pass-2026! (and, on the
// captcha page, the letters 7K2P). Never part of the CRM; only for development.
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, normalize } from "node:path";

const PORT = 5199;
const ROOT = join(import.meta.dirname, "..", "test-portals");
const RIGHT_ID = "test-agent";
const RIGHT_PASSWORD = "Test-Pass-2026!";

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/portal.css"><main>${body}<p><a href="/">All test portals</a></p></main>`;
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (req.method === "POST" && url.pathname === "/login") {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const sent = new URLSearchParams(raw);
      const values = [...sent.values()];
      const right = values.includes(RIGHT_ID) && values.includes(RIGHT_PASSWORD);
      const needsLetters = sent.has("captcha");
      const lettersRight = !needsLetters || sent.get("captcha")?.toUpperCase() === "7K2P";
      // Each attempt in the console (never the password), so whoever is testing sees the result here too.
      const from = new URL(req.headers.referer ?? "http://unknown/").pathname;
      const result = right && lettersRight ? `logged in as ${RIGHT_ID}` : right ? "wrong letters" : "wrong ID or password";
      console.log(`${new Date().toLocaleTimeString("en-IN")} ${from}: ${result}`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        right && lettersRight
          ? page("Logged in", `<h1>✓ Logged in as ${RIGHT_ID}</h1><p>The helper typed the right ID and password.</p>`)
          : page("Not logged in", `<h1>✗ ${right ? "Wrong letters" : "Wrong ID or password"}</h1>`),
      );
    });
    return;
  }
  // The portal moved: its login now lives at another address (127.0.0.1 is another site to the browser).
  if (url.pathname === "/redirect") {
    res.writeHead(302, { Location: `http://127.0.0.1:${PORT}/plain.html` });
    res.end();
    return;
  }
  const file = normalize(join(ROOT, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  const type = file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "text/html; charset=utf-8";
  res.writeHead(200, { "Content-Type": type });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`Test portals on http://localhost:${PORT} (ID ${RIGHT_ID}, password ${RIGHT_PASSWORD})`));
