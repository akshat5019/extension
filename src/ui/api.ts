export async function db<T = any>(
  type: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const response = await chrome.runtime.sendMessage({
    type: `DB_${type}`,
    ...data,
  });
  if (!response)
    throw new Error(
      "The extension database did not respond. Reload the extension.",
    );
  if (response.error) throw new Error(response.error);
  return response.result;
}
export async function form(
  tabId: number,
  type: string,
  data: Record<string, unknown> = {},
) {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: `FORM_${type}`,
    ...data,
  });
  if (!response)
    throw new Error("Form assistant did not respond. Scan the page again.");
  if (response.error) throw new Error(response.error);
  return response;
}
