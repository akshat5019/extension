import { collectFields, fieldValue, isRequired, writeField } from "./forms.js";
import { describe, mapper, type FormField } from "./core/mapping";
import { sensitive } from "./core/model";
type Input = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Snapshot = {
  element: Input;
  members?: HTMLInputElement[];
  label: string;
  key: string | null;
  type: string;
};
if (!(globalThis as any).__personalAssistV2) {
  (globalThis as any).__personalAssistV2 = true;
  let scanned = new Map<string, Snapshot>(),
    scanUrl = "",
    scanId = "",
    boundProfile = "";
  let undo = new Map<
    Input,
    { before: string | boolean; after: string | boolean }
  >();
  let edits = new Set<Input>();
  let baseline = new Map<Input, string>();
  const visible = () => new Set(collectFields(document) as Input[]);
  const info = (id: string, s: Snapshot): FormField => {
    const el = s.element;
    const options = s.members
      ? s.members.map((e) => ({
          value: e.value,
          label:
            Array.from(e.labels || [])
              .map((l) => l.textContent?.trim())
              .join(" ") || e.value,
        }))
      : el instanceof HTMLSelectElement
        ? Array.from(el.options)
            .filter((o) => !o.disabled && o.value)
            .map((o) => ({
              value: o.value,
              label: o.textContent?.trim() || o.value,
            }))
        : undefined;
    const reason = sensitive(s.label)
      ? "Sensitive or consent field: enter manually."
      : el.type === "file"
        ? "Upload files manually."
        : el instanceof HTMLSelectElement && el.multiple
          ? "Multiple selection requires manual entry."
          : s.members?.some((e) => e.disabled)
            ? "Radio group contains unavailable options."
            : undefined;
    return {
      id,
      label: s.label,
      key: reason ? null : s.key,
      type: s.type,
      required: s.members ? s.members.some((e) => e.required) : isRequired(el),
      current: s.members
        ? s.members.find((e) => e.checked)?.value || ""
        : fieldValue(el),
      valid:
        (!el.willValidate || el.checkValidity()) &&
        el.getAttribute("aria-invalid") !== "true",
      options,
      reason,
    };
  };
  function scan() {
    scanned = new Map();
    scanUrl = location.href;
    scanId = crypto.randomUUID();
    edits.clear();
    const elements = collectFields(document) as Input[];
    baseline = new Map(elements.map((el) => [el, el.value]));
    const seen = new Set<Input>();
    for (const el of elements) {
      if (seen.has(el)) continue;
      const d = describe(el);
      let members: HTMLInputElement[] | undefined;
      if (el.type === "radio") {
        members = elements.filter(
          (e) =>
            e.type === "radio" &&
            e instanceof HTMLInputElement &&
            e.name &&
            e.name === (el as HTMLInputElement).name &&
            e.form === el.form,
        ) as HTMLInputElement[];
        if (!members.length) members = [el as HTMLInputElement];
        members.forEach((e) => seen.add(e));
      }
      const id = String(scanned.size);
      scanned.set(id, { element: el, ...d, type: el.type, members });
    }
    return {
      scanId,
      url: scanUrl,
      fields: [...scanned].map(([id, s]) => info(id, s)),
      embeddedForms: document.querySelectorAll("iframe").length,
      customControls: document.querySelectorAll(
        '[role="combobox"],[contenteditable="true"]',
      ).length,
    };
  }
  function intact(s: Snapshot) {
    return (
      s.element.isConnected &&
      visible().has(s.element) &&
      describe(s.element).label === s.label &&
      describe(s.element).key === s.key &&
      s.element.type === s.type
    );
  }
  function setControl(el: Input, value: string | boolean) {
    if (typeof value === "boolean" && el instanceof HTMLInputElement) {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "checked",
      )!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    if (value === "") {
      const proto =
        el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return writeField(el, String(value));
  }
  function clearFilled() {
    let restored = 0,
      kept = 0;
    for (const [el, value] of undo) {
      const current =
        typeof value.after === "boolean"
          ? (el as HTMLInputElement).checked
          : el.value;
      if (el.isConnected && current === value.after && !edits.has(el)) {
        setControl(el, value.before);
        restored++;
      } else kept++;
    }
    undo.clear();
    boundProfile = "";
    return { restored, kept };
  }
  for (const type of ["input", "change"])
    document.addEventListener(
      type,
      (event) => {
        if (event.isTrusted && event.target instanceof HTMLElement)
          edits.add(event.target as Input);
      },
      true,
    );
  // No startup form reads, uploads, database requests or automatic filling.
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    try {
      if (message.type === "FORM_SCAN") {
        respond(scan());
        return;
      }
      if (message.type === "FORM_UNDO") {
        respond(clearFilled());
        return;
      }
      if (message.scanId !== scanId || scanUrl !== location.href)
        throw new Error("The page changed. Scan this step again.");
      if (message.type === "FORM_FILL") {
        if (boundProfile && boundProfile !== message.profileId)
          throw new Error(
            "Undo the previous person’s autofill before selecting another person.",
          );
        boundProfile = message.profileId;
        const results = [];
        for (const [id, s] of scanned) {
          const f = info(id, s);
          if (!intact(s)) {
            results.push({
              id,
              filled: false,
              reason: "Field changed since scanning.",
            });
            continue;
          }
          if (f.current) {
            results.push({
              id,
              filled: false,
              reason: "Existing value preserved.",
            });
            continue;
          }
          const value =
            message.answers?.[id] ||
            mapper.value(
              message.fields || {},
              f,
              message.includePersonal === true,
            );
          if (!value || f.reason) {
            results.push({
              id,
              filled: false,
              reason: f.reason || "No confirmed matching value.",
            });
            continue;
          }
          if (s.members) {
            const option = f.options?.find(
              (o) =>
                o.value.toLowerCase() === String(value).toLowerCase() ||
                o.label.toLowerCase() === String(value).toLowerCase(),
            );
            const chosen = s.members.find((el) => el.value === option?.value);
            if (!chosen) {
              results.push({
                id,
                filled: false,
                reason: "No matching radio option.",
              });
              continue;
            }
            for (const el of s.members) {
              const before = el.checked;
              setControl(el, el === chosen);
              undo.set(el, { before, after: el.checked });
            }
            results.push({ id, filled: true });
          } else if (s.type === "checkbox") {
            if (!/^(true|yes|1|checked)$/i.test(String(value))) {
              results.push({
                id,
                filled: false,
                reason: "Checkbox needs an explicit yes value.",
              });
              continue;
            }
            const el = s.element as HTMLInputElement;
            const before = el.checked;
            setControl(el, true);
            undo.set(el, { before, after: true });
            results.push({ id, filled: true });
          } else {
            const before = s.element.value;
            if (setControl(s.element, String(value))) {
              if (s.element.willValidate && !s.element.checkValidity()) {
                setControl(s.element, before);
                results.push({
                  id,
                  filled: false,
                  reason:
                    "Value failed portal validation; enter a valid answer.",
                });
              } else {
                undo.set(s.element, { before, after: s.element.value });
                results.push({ id, filled: true });
              }
            } else
              results.push({
                id,
                filled: false,
                reason: "Unsupported value or control.",
              });
          }
        }
        respond({
          results,
          fields: [...scanned].map(([id, s]) => info(id, s)),
          scanId,
          url: scanUrl,
        });
        return;
      }
      if (message.type === "FORM_EDITS") {
        if (boundProfile !== message.profileId)
          throw new Error(
            "Select and fill this profile before capturing page edits.",
          );
        respond({
          fields: [...scanned]
            .filter(
              ([, s]) =>
                intact(s) &&
                edits.has(s.element) &&
                s.element.value !== baseline.get(s.element),
            )
            .map(([id, s]) => ({ ...info(id, s), value: s.element.value }))
            .filter(
              (f) =>
                f.valid &&
                !f.reason &&
                !["radio", "checkbox", "file", "password"].includes(f.type),
            ),
          scanId,
          url: scanUrl,
        });
        return;
      }
    } catch (error) {
      respond({
        error: error instanceof Error ? error.message : "Form unavailable.",
      });
    }
  });
}
