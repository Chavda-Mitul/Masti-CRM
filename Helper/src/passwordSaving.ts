// Chrome offers "Save password?" after a login form is sent, including one the helper filled. Saving it would put the
// portal's password in that person's own password manager, where they could read it (docs/decisions/0024-portal-logins.md).
// So the helper switches the offer off while it's installed; Chrome restores it when the helper is removed. On the office
// PCs a Chrome policy does the same (component 4).

type Setting = Pick<chrome.types.ChromeSetting<boolean>, "get" | "set">;

export async function turnOffPasswordSaving(setting: Setting): Promise<void> {
  const current = await setting.get({});
  const ours = current.levelOfControl === "controllable_by_this_extension" || current.levelOfControl === "controlled_by_this_extension";
  if (ours && current.value !== false) await setting.set({ value: false });
}
