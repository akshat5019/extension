/** Chrome includes sender.tab for extension pages opened as normal tabs.
 * Authorize our UI by its extension ID and exact page URL, not by absence of a tab.
 * Website content scripts must never be allowed to query the profile database.
 */
export function isTrustedUI(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
  extensionRoot: string,
): boolean {
  if (
    sender.id !== extensionId ||
    !sender.url ||
    (sender.frameId !== undefined && sender.frameId !== 0)
  )
    return false;
  try {
    const url = new URL(sender.url);
    const root = new URL(extensionRoot);
    return (
      url.protocol === root.protocol &&
      url.host === root.host &&
      !url.username &&
      !url.password &&
      ["/popup.html", "/manager.html"].includes(url.pathname)
    );
  } catch {
    return false;
  }
}
