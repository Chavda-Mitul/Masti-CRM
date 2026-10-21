// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { fillLogin } from "../src/fill";

// Many portals are React (or Angular) pages, which keep a box's value in their own state: typing must reach that state,
// not just the box.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function LoginForm({ onLogin }: { onLogin: (id: string, password: string) => void }) {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onLogin(id, password);
      }}
    >
      <label>
        User ID <input value={id} onChange={(event) => setId(event.target.value)} />
      </label>
      <label>
        Password <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <button type="submit">Login</button>
    </form>
  );
}

it("fills a React form so React sees the values", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const sent: [string, string][] = [];
  const root = createRoot(container);
  await act(async () => root.render(<LoginForm onLogin={(id, password) => sent.push([id, password])} />));

  let outcome: string | undefined;
  await act(async () => {
    outcome = await fillLogin({ loginId: "MASTI-AGENT-01", password: "Spring-Visa-2026!" }, [location.origin], 0);
  });
  expect(outcome).toBe("SUBMITTED");
  expect(sent).toEqual([["MASTI-AGENT-01", "Spring-Visa-2026!"]]);
  await act(async () => root.unmount());
});
