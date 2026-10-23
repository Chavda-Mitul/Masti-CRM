// The helper's little popup (docs/decisions/0024-portal-logins.md): one switch for the "other extensions on" check. The
// office build always runs the check; this switch only has an effect while the helper is loaded unpacked for
// development, so a developer can keep their own extensions on and turn the check off while building, then on to test it.

const box = document.getElementById("enforceInDev") as HTMLInputElement;
const note = document.getElementById("note") as HTMLElement;

async function load() {
  const self = await chrome.management.getSelf();
  const isDev = self.installType === "development";
  const { enforceInDev = false } = await chrome.storage.local.get("enforceInDev");
  // Off a development build the check always runs, so the box is shown ticked and locked.
  box.checked = isDev ? Boolean(enforceInDev) : true;
  box.disabled = !isDev;
  note.textContent = isDev
    ? "Development build. On: the check runs here too (to test it). Off: build without it blocking you."
    : "Office build: the check always runs and can't be switched off here.";
}

box.addEventListener("change", () => void chrome.storage.local.set({ enforceInDev: box.checked }));

void load();
