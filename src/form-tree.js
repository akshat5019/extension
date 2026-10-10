export function isVisible(element) {
  if (!element.isConnected || element.closest("[hidden],[inert]")) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (
    !style ||
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    (!element.getClientRects().length &&
      !(
        style.display === "contents" &&
        !element.matches("input,select,textarea,iframe")
      ))
  )
    return false;
  const root = element.getRootNode();
  if (root.host && !isVisible(root.host)) return false;
  return true;
}

export function collectFormTree(doc) {
  const state = {
    fields: [],
    accessibleFrames: 0,
    inaccessibleFrames: 0,
    shadowRoots: 0,
    customControls: 0,
    truncated: false,
  };
  const seen = new Set();
  function visit(root) {
    if (seen.has(root)) return;
    if (seen.size >= 100 || state.fields.length >= 2000) {
      state.truncated = true;
      return;
    }
    seen.add(root);
    for (const node of root.querySelectorAll("*")) {
      if (state.fields.length >= 2000) {
        state.truncated = true;
        break;
      }
      if (node.shadowRoot && isVisible(node)) {
        state.shadowRoots++;
        visit(node.shadowRoot);
      }
      if (node.tagName === "IFRAME" && isVisible(node)) {
        try {
          const child = node.contentDocument;
          if (!child) state.inaccessibleFrames++;
          else {
            state.accessibleFrames++;
            visit(child);
          }
        } catch {
          state.inaccessibleFrames++;
        }
      }
      if (
        node.matches('[role="combobox"],[contenteditable="true"]') &&
        isVisible(node)
      )
        state.customControls++;
      if (
        !node.matches("input,select,textarea") ||
        node.disabled ||
        node.readOnly ||
        !isVisible(node) ||
        ["hidden", "submit", "button", "reset", "image", "password"].includes(
          node.type,
        )
      )
        continue;
      state.fields.push(node);
    }
  }
  visit(doc);
  return state;
}
