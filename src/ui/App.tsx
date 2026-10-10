import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { db, form } from "./api";
import {
  BASE_FIELDS,
  LABELS,
  display,
  personName,
  cleanFields,
  combine,
  conflicts,
  identityMatches,
  normal,
  phoneKey,
  sensitive,
  type Person,
  type Fields,
  type ConflictChoice,
  type DocumentRecord,
} from "../core/model";
import { mapper, type FormField } from "../core/mapping";
import { readDocument } from "../core/documents";
import type { Candidate } from "../core/extraction";
import { prepareLocalModel, type OnDeviceIntelligence } from "../core/ai";
import { portalPattern } from "../portal.js";

type Match = { person: Person; reasons: string[] };
type ReviewRow = Candidate & {
  matches: Match[];
  action: "" | "create" | "update" | "skip";
  target?: Person;
  choices: Record<string, ConflictChoice>;
};
function FieldEditor({
  fields,
  onChange,
}: {
  fields: Fields;
  onChange: (fields: Fields) => void;
}) {
  const [keys, setKeys] = useState(() => [
    ...new Set([
      "fullName",
      "email",
      "phone",
      "address",
      ...Object.keys(fields),
    ]),
  ]);
  const [newKey, setNewKey] = useState("");
  useEffect(
    () => setKeys((k) => [...new Set([...k, ...Object.keys(fields)])]),
    [fields],
  );
  return (
    <div className="field-editor">
      {keys.map((key) => (
        <label key={key}>
          {LABELS[key] || key.replace("custom:", "")}
          <input
            aria-label={LABELS[key] || key}
            value={display(fields[key])}
            onChange={(e) =>
              onChange({
                ...fields,
                [key]: Array.isArray(fields[key])
                  ? e.target.value.split(";").map((x) => x.trim())
                  : e.target.value,
              })
            }
          />
        </label>
      ))}
      <div className="inline">
        <select
          aria-label="Add standard field"
          value=""
          onChange={(e) => setKeys((k) => [...new Set([...k, e.target.value])])}
        >
          <option value="">Add standard field…</option>
          {BASE_FIELDS.filter((k) => !keys.includes(k)).map((k) => (
            <option key={k} value={k}>
              {LABELS[k] || k}
            </option>
          ))}
        </select>
      </div>
      <div className="inline">
        <input
          aria-label="Custom field name"
          placeholder="Custom field label"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            if (newKey.trim() && !sensitive(newKey)) {
              setKeys((k) => [...new Set([...k, `custom:${normal(newKey)}`])]);
              setNewKey("");
            }
          }}
        >
          Add field
        </button>
      </div>
      <p className="muted">
        Remove a value by clearing it. Alternate values are separated with
        semicolons. Password, banking and authentication fields are excluded.
      </p>
    </div>
  );
}
function Choices({
  old,
  next,
  choices,
  onChange,
}: {
  old: Fields;
  next: Fields;
  choices: Record<string, ConflictChoice>;
  onChange: (c: Record<string, ConflictChoice>) => void;
}) {
  return (
    <div>
      {conflicts(old, next).map((key) => (
        <div className="conflict" key={key}>
          <strong>{LABELS[key] || key}</strong>
          <div>Existing: {display(old[key])}</div>
          <div>New: {display(next[key])}</div>
          <select
            aria-label={`Resolve ${key}`}
            value={choices[key] || ""}
            onChange={(e) =>
              onChange({ ...choices, [key]: e.target.value as ConflictChoice })
            }
          >
            <option value="">Choose a resolution…</option>
            <option value="replace">Replace with new value</option>
            <option value="both">Keep both (review before filling)</option>
            <option value="keep">Leave unchanged</option>
          </select>
        </div>
      ))}
    </div>
  );
}
function App() {
  const [view, setView] = useState("autofill"),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [results, setResults] = useState<Person[]>([]),
    [total, setTotal] = useState(0),
    [selected, setSelected] = useState<Person>();
  const [stats, setStats] = useState<{
    total: number;
    review: number;
    documents: DocumentRecord[];
  }>({ total: 0, review: 0, documents: [] });
  const [editor, setEditor] = useState<Fields>(),
    [editing, setEditing] = useState<Person>();
  const [duplicateMatches, setDuplicateMatches] = useState<Match[]>([]),
    [mergeTarget, setMergeTarget] = useState<Person>(),
    [mergeChoices, setMergeChoices] = useState<Record<string, ConflictChoice>>(
      {},
    );
  const [tab, setTab] = useState<chrome.tabs.Tab>(),
    [scan, setScan] = useState<{
      scanId: string;
      url: string;
      fields: FormField[];
      embeddedForms: number;
      customControls: number;
    }>(),
    [fillReport, setFillReport] = useState<any[]>([]),
    [includePersonal, setIncludePersonal] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({}),
    [learning, setLearning] = useState<Fields>(),
    [learningChoices, setLearningChoices] = useState<
      Record<string, ConflictChoice>
    >({}),
    [learningPerson, setLearningPerson] = useState<Person>();
  const [rows, setRows] = useState<ReviewRow[]>([]),
    [rowIndex, setRowIndex] = useState(0),
    [importName, setImportName] = useState(""),
    [fingerprint, setFingerprint] = useState(""),
    [warnings, setWarnings] = useState<string[]>([]),
    [reviewed, setReviewed] = useState(false);
  const [hosts, setHosts] = useState<string[]>([]),
    [confirm, setConfirm] = useState<
      "delete" | "clear" | "export" | undefined
    >();
  const searchVersion = useRef(0);
  const [editorChoices, setEditorChoices] = useState<
    Record<string, ConflictChoice>
  >({});
  useEffect(() => setEditorChoices({}), [editing]);
  const [intelligence, setIntelligence] = useState<OnDeviceIntelligence>();
  useEffect(() => () => intelligence?.dispose(), [intelligence]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await task();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([t]) => setTab(t));
    chrome.permissions.getAll().then((p) => setHosts(p.origins || []));
  }, []);
  useEffect(() => {
    const version = ++searchVersion.current;
    const timer = setTimeout(() => {
      db("SEARCH", { query, offset })
        .then((r) => {
          if (version === searchVersion.current) {
            setResults(r.items);
            setTotal(r.total);
          }
        })
        .catch((e) => setNotice(e.message));
    }, 150);
    return () => clearTimeout(timer);
  }, [query, offset, refresh]);
  useEffect(() => {
    db("STATS")
      .then(setStats)
      .catch((e) => setNotice(e.message));
  }, [refresh]);
  function choose(p: Person) {
    setSelected(p);
    setAnswers({});
    setLearning(undefined);
    setScan(undefined);
    setFillReport([]);
    setEditor(undefined);
    setEditing(undefined);
    setDuplicateMatches([]);
    setMergeTarget(undefined);
    setNotice(
      `Selected ${personName(p.fields)}. Existing page values will be preserved.`,
    );
  }
  async function scanPage() {
    if (!selected) throw new Error("Search for and select a person first.");
    if (!tab?.id || !/^https?:\/\//.test(tab.url || ""))
      throw new Error(
        "Open a normal website form, then open this extension. Browser-internal pages are protected.",
      );
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    const result = await form(tab.id, "SCAN");
    setScan(result);
    setAnswers({});
    setFillReport([]);
    setNotice(
      result.fields.length
        ? `Detected ${result.fields.length} fields. Review before filling.${result.embeddedForms ? " Embedded frames need separate access." : ""}${result.customControls ? " Custom controls may need manual entry." : ""}`
        : "No supported visible fields found.",
    );
  }
  async function fill() {
    if (!selected || !scan || !tab?.id)
      throw new Error("Select a person and scan this page first.");
    const latest = await db<Person>("GET", { id: selected.id });
    if (!latest || latest.revision !== selected.revision)
      throw new Error("Profile changed. Select it again before filling.");
    const result = await form(tab.id, "FILL", {
      scanId: scan.scanId,
      profileId: selected.id,
      fields: selected.fields,
      answers,
      includePersonal,
    });
    setScan({ ...scan, fields: result.fields });
    setFillReport(result.results);
    const proposed: Fields = {};
    for (const f of scan.fields)
      if (
        answers[f.id] &&
        result.results.some((r: any) => r.id === f.id && r.filled) &&
        f.key &&
        !f.reason
      )
        proposed[f.key] =
          f.options?.find((o) => o.value === answers[f.id])?.label ||
          answers[f.id];
    if (Object.keys(proposed).length) {
      setLearning(proposed);
      setLearningPerson(selected);
      setLearningChoices({});
    }
    setNotice(
      `Filled ${result.results.filter((r: any) => r.filled).length} fields for ${personName(selected.fields)}. Review the page and submit manually. New answers are not saved until you confirm.`,
    );
  }
  async function importFile(file: File) {
    setRows([]);
    setReviewed(false);
    setImportName(file.name);
    const parsed = await readDocument(file, setNotice, intelligence);
    setFingerprint(parsed.fingerprint);
    setWarnings(parsed.warnings);
    setNotice(
      `Checking ${parsed.candidates.length} records for potential duplicates…`,
    );
    const matches: Match[][] = await db("ANALYZE", {
      records: parsed.candidates.map((c) => c.fields),
    });
    const seen = new Map<string, number>();
    const reviewedRows = parsed.candidates.map((c, i) => {
      const issues = [...c.warnings];
      const ids = [
        c.fields.email ? `email:${normal(c.fields.email)}` : "",
        c.fields.phone ? `phone:${phoneKey(c.fields.phone)}` : "",
        c.fields.fullName ? `name:${normal(c.fields.fullName)}` : "",
      ].filter(Boolean);
      for (const id of ids) {
        if (seen.has(id))
          issues.push(
            `Potential duplicate of imported record ${seen.get(id)! + 1}; choose separate profile or skip.`,
          );
        else seen.set(id, i);
      }
      return {
        ...c,
        warnings: issues,
        matches: matches[i],
        action: matches[i].length || issues.length ? "" : "create",
        choices: {},
      } as ReviewRow;
    });
    setRows(reviewedRows);
    setRowIndex(0);
    setNotice(
      `${reviewedRows.length} candidate profiles. Resolve review items and confirm the import.`,
    );
  }
  function changeRow(patch: Partial<ReviewRow>) {
    setRows((all) =>
      all.map((r, i) => (i === rowIndex ? { ...r, ...patch } : r)),
    );
    setReviewed(false);
  }
  async function saveEditor() {
    if (!editor) throw new Error("Open a profile editor.");
    if (!editing) {
      const matches = await db<Match[]>("MATCHES", { fields: editor });
      if (matches.length && !duplicateMatches.length) {
        setDuplicateMatches(matches);
        setNotice(
          "Potential duplicates found. Review them; use Confirm separate profile to create another person.",
        );
        return;
      }
    }
    const p = await db<Person>("SAVE", {
      fields: editing
        ? combine(editing.fields, editor, editorChoices)
        : cleanFields(editor),
      id: editing?.id,
      revision: editing?.revision,
      status: "verified",
    });
    setSelected(p);
    setEditing(undefined);
    setEditor(undefined);
    setDuplicateMatches([]);
    setRefresh((x) => x + 1);
    setNotice("Profile saved.");
  }
  async function saveLearning() {
    if (!learning || !learningPerson || selected?.id !== learningPerson.id)
      throw new Error("The selected person changed. Review answers again.");
    const fields = combine(learningPerson.fields, learning, learningChoices);
    const p = await db<Person>("SAVE", {
      id: learningPerson.id,
      revision: learningPerson.revision,
      fields,
      source: `Confirmed form answers on ${scan?.url || tab?.url || ""}`,
    });
    setSelected(p);
    setLearning(undefined);
    setRefresh((x) => x + 1);
    setNotice(`Confirmed details saved to ${personName(p.fields)} only.`);
  }
  const row = rows[rowIndex];
  return (
    <main>
      <header>
        <div className="brand">
          <span className="mark">P</span>
          <div>
            <strong>Personal Assist</strong>
            <div className="muted">Local profiles · reviewed autofill</div>
          </div>
        </div>
        <button
          onClick={() =>
            chrome.tabs.create({ url: chrome.runtime.getURL("manager.html") })
          }
        >
          Open workspace
        </button>
      </header>
      <section className="search">
        <label htmlFor="search">Find the person to use</label>
        <input
          id="search"
          disabled={busy}
          type="search"
          placeholder="Search name, phone, email or company…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <div className="inline">
          <small>{total} matching profiles</small>
          <button
            onClick={() => {
              setQuery("");
              setOffset(0);
            }}
          >
            Clear search
          </button>
        </div>
      </section>
      <nav>
        {["autofill", "dashboard", "people", "import", "settings"].map((v) => (
          <button
            key={v}
            aria-current={view === v ? "page" : undefined}
            onClick={() => {
              setView(v);
              setConfirm(undefined);
            }}
          >
            {v === "autofill" ? "Fill form" : v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </nav>
      <p id="status" role="status" className={notice ? "notice" : "muted"}>
        {busy ? "Working locally… " : ""}
        {notice}
      </p>
      {["autofill", "people"].includes(view) && (
        <section>
          <h2>Select a profile</h2>
          <div className="profile-list">
            {results.map((p) => (
              <button
                className={`person ${selected?.id === p.id ? "selected" : ""}`}
                disabled={busy}
                key={p.id}
                onClick={() => choose(p)}
              >
                <strong>{personName(p.fields)}</strong>
                <span>
                  {display(p.fields.phone) || "No phone"} ·{" "}
                  {display(p.fields.email) || "No email"}
                </span>
                <small>
                  {display(p.fields.currentCompany)} ·{" "}
                  {p.status === "review" ? "Needs review" : "Verified"} ·{" "}
                  {p.id.slice(0, 8)}
                </small>
              </button>
            ))}
          </div>
          {!results.length && (
            <p>
              No matching profile found. Add a profile or import a document.
            </p>
          )}
          <div className="inline">
            <button
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 20))}
            >
              Previous
            </button>
            <span>
              {offset + 1}–{Math.min(offset + 20, total)} of {total}
            </span>
            <button
              disabled={offset + 20 >= total}
              onClick={() => setOffset(offset + 20)}
            >
              Next
            </button>
          </div>
          <div className="inline">
            <button
              onClick={() => {
                setEditor({});
                setEditing(undefined);
                setDuplicateMatches([]);
                setView("people");
              }}
            >
              Add profile
            </button>
            <button onClick={() => setView("import")}>Import document</button>
          </div>
        </section>
      )}
      {selected && (
        <aside className="selected-banner">
          Using <strong>{personName(selected.fields)}</strong> ·{" "}
          {display(selected.fields.phone)} · ID {selected.id.slice(0, 8)}
          <button
            disabled={busy}
            onClick={() => {
              setSelected(undefined);
              setScan(undefined);
              setLearning(undefined);
            }}
          >
            Deselect
          </button>
        </aside>
      )}
      {view === "dashboard" && (
        <section>
          <h1>Your information workspace</h1>
          <div className="metrics">
            <div>
              <strong>{stats.total}</strong>profiles
            </div>
            <div>
              <strong>{stats.review}</strong>need review
            </div>
          </div>
          <div className="inline">
            <button onClick={() => setView("people")}>Manage profiles</button>
            <button onClick={() => setView("import")}>Import documents</button>
          </div>
          <h2>Recent imports</h2>
          {stats.documents.map((d) => (
            <article key={d.id}>
              <strong>{d.name}</strong>
              <p>
                {d.count} profiles · {new Date(d.importedAt).toLocaleString()}
              </p>
              {d.warnings.map((w, i) => (
                <small key={i}>{w}</small>
              ))}
            </article>
          ))}
          {!stats.documents.length && <p>No documents imported yet.</p>}
        </section>
      )}
      {view === "autofill" && (
        <section>
          <h2>Fill the current website</h2>
          <p className="muted">
            {tab?.url || "Open this extension from a website tab."}
          </p>
          <p>
            Select a person, scan, then fill. Existing values remain unchanged.
            Forms are submitted manually.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={includePersonal}
              onChange={(e) => setIncludePersonal(e.target.checked)}
            />{" "}
            Include date of birth and gender from this profile for this fill
          </label>
          <div className="inline">
            <button
              className="primary"
              disabled={busy || !selected}
              onClick={() => run(scanPage)}
            >
              Scan form
            </button>
            <button
              className="primary"
              disabled={busy || !selected || !scan}
              onClick={() => run(fill)}
            >
              Fill form
            </button>
            <button
              disabled={busy || !tab?.id}
              onClick={() =>
                run(async () => {
                  const r = await form(tab!.id!, "UNDO");
                  setScan(undefined);
                  setFillReport([]);
                  setLearning(undefined);
                  setNotice(
                    `Restored ${r.restored} autofilled fields; preserved ${r.kept} changed values.`,
                  );
                })
              }
            >
              Undo autofill
            </button>
          </div>
          {scan && (
            <>
              <h3>
                {scan.fields.filter((f) => !f.current && f.required).length}{" "}
                required fields still empty
              </h3>
              {scan.fields.map((f) => (
                <article className="form-field" key={f.id}>
                  <strong>
                    {f.label}
                    {f.required ? " *" : ""}
                  </strong>
                  <small>
                    {f.current
                      ? "Existing / filled value preserved"
                      : f.reason ||
                        fillReport.find((r) => r.id === f.id)?.reason ||
                        (mapper.value(
                          selected?.fields || {},
                          f,
                          includePersonal,
                        )
                          ? "Matching profile value ready"
                          : "Missing or requires manual review")}
                  </small>
                  {!f.current && !f.reason && f.key && (
                    <label>
                      Answer for this application
                      {f.options ? (
                        <select
                          aria-label={`Answer ${f.label}`}
                          value={answers[f.id] || ""}
                          onChange={(e) =>
                            setAnswers((a) => ({
                              ...a,
                              [f.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Choose…</option>
                          {f.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-label={`Answer ${f.label}`}
                          type={
                            ["email", "date", "number", "tel"].includes(f.type)
                              ? f.type
                              : "text"
                          }
                          value={answers[f.id] || ""}
                          onChange={(e) =>
                            setAnswers((a) => ({
                              ...a,
                              [f.id]: e.target.value,
                            }))
                          }
                        />
                      )}
                    </label>
                  )}
                </article>
              ))}
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await form(tab!.id!, "EDITS", {
                      scanId: scan.scanId,
                      profileId: selected!.id,
                    });
                    const fields: Fields = {};
                    for (const f of r.fields)
                      if (f.key && f.value) fields[f.key] = f.value;
                    if (!Object.keys(fields).length)
                      throw new Error(
                        "No valid manual edits captured. Enter details on the page after filling this profile.",
                      );
                    setLearning(fields);
                    setLearningPerson(selected);
                    setLearningChoices({});
                  })
                }
              >
                Review answers entered on page
              </button>
            </>
          )}
          {learning && learningPerson && (
            <div className="review">
              <h3>Save to {personName(learningPerson.fields)}?</h3>
              <p>
                These changes affect only profile{" "}
                {learningPerson.id.slice(0, 8)}. Nothing is saved until you
                confirm.
              </p>
              <FieldEditor fields={learning} onChange={setLearning} />
              <Choices
                old={learningPerson.fields}
                next={learning}
                choices={learningChoices}
                onChange={setLearningChoices}
              />
              <div className="inline">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => run(saveLearning)}
                >
                  Confirm save to selected profile
                </button>
                <button onClick={() => setLearning(undefined)}>
                  Use once / discard
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      {view === "people" && (
        <section>
          <h2>Profile manager</h2>
          {selected && !editor && (
            <>
              <dl>
                {Object.entries(selected.fields).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt>{LABELS[k] || k.replace("custom:", "")}</dt>
                    <dd>{display(v)}</dd>
                  </React.Fragment>
                ))}
              </dl>
              <p className="muted">
                Created {new Date(selected.createdAt).toLocaleString()} ·
                Updated {new Date(selected.updatedAt).toLocaleString()} ·
                Revision {selected.revision}
              </p>
              <details>
                <summary>Sources and history</summary>
                {selected.sources.map((s, i) => (
                  <p key={i}>
                    {s.name} · {new Date(s.at).toLocaleString()} ·{" "}
                    {s.fields.join(", ")}
                  </p>
                ))}
              </details>
              <div className="inline">
                <button
                  onClick={() => {
                    setEditing(selected);
                    setEditor({ ...selected.fields });
                  }}
                >
                  Edit profile
                </button>
                <button
                  onClick={() =>
                    run(async () => {
                      const m = await db<Match[]>("MATCHES", {
                        fields: selected.fields,
                      });
                      setDuplicateMatches(
                        m.filter((x) => x.person.id !== selected.id),
                      );
                      setNotice(
                        "Potential matches require your review. Names are not unique identities.",
                      );
                    })
                  }
                >
                  Review duplicates
                </button>
                <button className="danger" onClick={() => setConfirm("delete")}>
                  Delete profile
                </button>
              </div>
            </>
          )}
          {editor && (
            <>
              <h3>{editing ? "Edit profile" : "New person"}</h3>
              <FieldEditor fields={editor} onChange={setEditor} />
              {editing && (
                <Choices
                  old={editing.fields}
                  next={editor}
                  choices={editorChoices}
                  onChange={setEditorChoices}
                />
              )}
              <div className="inline">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => run(saveEditor)}
                >
                  {duplicateMatches.length && !editing
                    ? "Confirm separate profile"
                    : "Save profile"}
                </button>
                <button
                  onClick={() => {
                    setEditor(undefined);
                    setDuplicateMatches([]);
                  }}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
          {duplicateMatches.length > 0 && (
            <div className="review">
              <h3>Potential matches</h3>
              {duplicateMatches.map((m) => (
                <article key={m.person.id}>
                  <strong>{personName(m.person.fields)}</strong>
                  <p>
                    {display(m.person.fields.email)} ·{" "}
                    {display(m.person.fields.phone)}
                  </p>
                  <p>{m.reasons.join(", ")}</p>
                  <button
                    onClick={() => {
                      if (editor && !editing) {
                        setEditing(m.person);
                        setEditor({
                          ...m.person.fields,
                          ...cleanFields(editor),
                        });
                        setDuplicateMatches([]);
                        setNotice(
                          "Review matching and conflicting values, then choose how to save this existing profile.",
                        );
                      } else {
                        setMergeTarget(m.person);
                        setMergeChoices({});
                      }
                    }}
                  >
                    {editor && !editing
                      ? "Open existing profile instead"
                      : "Review merge into this profile"}
                  </button>
                </article>
              ))}
            </div>
          )}
          {mergeTarget && selected && (
            <div className="review">
              <h3>
                Merge {personName(selected.fields)} into{" "}
                {personName(mergeTarget.fields)}?
              </h3>
              <p>
                The source profile will be deleted. All sources will be retained
                on the target.
              </p>
              <Choices
                old={mergeTarget.fields}
                next={selected.fields}
                choices={mergeChoices}
                onChange={setMergeChoices}
              />
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const p = await db<Person>("MERGE", {
                      targetId: mergeTarget.id,
                      sourceId: selected.id,
                      targetRevision: mergeTarget.revision,
                      sourceRevision: selected.revision,
                      choices: mergeChoices,
                    });
                    setSelected(p);
                    setMergeTarget(undefined);
                    setDuplicateMatches([]);
                    setRefresh((x) => x + 1);
                    setNotice("Profiles merged after confirmation.");
                  })
                }
              >
                Confirm merge and remove source
              </button>
              <button onClick={() => setMergeTarget(undefined)}>
                Cancel merge
              </button>
            </div>
          )}
        </section>
      )}
      {view === "import" && (
        <section>
          <h2>Import documents</h2>
          <p>
            One table row or explicitly labelled block per person. All
            extraction runs locally. PDF, DOCX, TXT, CSV, XLSX and JSON are
            supported. Scans/images require external OCR before import; no cloud
            AI or OCR service is contacted.{" "}
            {intelligence
              ? "On-device AI is enabled for free-form text; verify every inferred record."
              : "Standard local extraction is active."}
          </p>
          <label className="upload">
            Choose document
            <input
              aria-label="Upload document"
              type="file"
              accept=".pdf,.docx,.txt,.csv,.xlsx,.json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) run(() => importFile(file));
                e.target.value = "";
              }}
            />
          </label>
          {warnings.length > 0 && (
            <details open>
              <summary>Extraction warnings</summary>
              {warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </details>
          )}
          {row && (
            <div className="review">
              <h3>
                {importName} · Record {rowIndex + 1} of {rows.length}
              </h3>
              <div className="inline">
                <button
                  disabled={!rowIndex}
                  onClick={() => setRowIndex((i) => i - 1)}
                >
                  Previous record
                </button>
                <button
                  disabled={rowIndex + 1 >= rows.length}
                  onClick={() => setRowIndex((i) => i + 1)}
                >
                  Next record
                </button>
                <button
                  onClick={() => {
                    const i = rows.findIndex((r) => !r.action);
                    if (i >= 0) setRowIndex(i);
                  }}
                >
                  Next unresolved
                </button>
              </div>
              {row.warnings.map((w, i) => (
                <p className="warning" key={i}>
                  {w}
                </p>
              ))}
              <FieldEditor
                key={rowIndex}
                fields={row.fields}
                onChange={(fields) =>
                  changeRow({
                    fields,
                    action: "",
                    target: undefined,
                    choices: {},
                  })
                }
              />
              {row.matches.map((m) => (
                <article key={m.person.id}>
                  <strong>
                    Potential match: {personName(m.person.fields)}
                  </strong>
                  <p>
                    {display(m.person.fields.phone)} ·{" "}
                    {display(m.person.fields.email)}
                  </p>
                  <p>{m.reasons.join(", ")}</p>
                  <button
                    onClick={() =>
                      changeRow({
                        action: "update",
                        target: m.person,
                        choices: {},
                      })
                    }
                  >
                    Review update to this profile
                  </button>
                </article>
              ))}
              <label>
                Record decision
                <select
                  aria-label="Record decision"
                  value={row.action}
                  onChange={(e) =>
                    changeRow({
                      action: e.target.value as ReviewRow["action"],
                      target: undefined,
                      choices: {},
                    })
                  }
                >
                  <option value="">Review and choose…</option>
                  <option value="create">Create a separate profile</option>
                  {row.action === "update" && (
                    <option value="update">
                      Update selected existing profile
                    </option>
                  )}
                  <option value="skip">Skip this record</option>
                </select>
              </label>
              {row.action === "update" && row.target && (
                <Choices
                  old={row.target.fields}
                  next={row.fields}
                  choices={row.choices}
                  onChange={(choices) => changeRow({ choices })}
                />
              )}
              <p>
                {rows.filter((r) => !r.action).length} records still require a
                decision. Uncertain records may be stored with Needs review
                status.
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                I reviewed the person boundaries, values and duplicate
                decisions.
              </label>
              <button
                className="primary"
                disabled={busy || !reviewed || rows.some((r) => !r.action)}
                onClick={() =>
                  run(async () => {
                    const result = await db("IMPORT", {
                      fingerprint,
                      name: importName,
                      warnings,
                      records: rows.map((r) => ({
                        fields: cleanFields(r.fields),
                        action: r.action,
                        targetId: r.target?.id,
                        revision: r.target?.revision,
                        choices: r.choices,
                        review: r.warnings.length > 0,
                      })),
                    });
                    setRows([]);
                    setRefresh((x) => x + 1);
                    setNotice(
                      `Import complete: ${result.created} created, ${result.updated} updated, ${result.review} need review, ${result.skipped} skipped.`,
                    );
                  })
                }
              >
                Confirm import
              </button>
              <button
                onClick={() => {
                  setRows([]);
                  setWarnings([]);
                }}
              >
                Discard staged import
              </button>
              <button
                onClick={() => {
                  setRows((all) => [
                    ...all,
                    {
                      fields: {},
                      record: all.length + 1,
                      warnings: [
                        "Manually split record: verify identity and move only the correct person’s values.",
                      ],
                      matches: [],
                      action: "",
                      choices: {},
                    },
                  ]);
                  setRowIndex(rows.length);
                  setReviewed(false);
                }}
              >
                Add separate record / split person
              </button>
            </div>
          )}
        </section>
      )}
      {view === "settings" && (
        <section>
          <h2>Privacy and settings</h2>
          <p>
            Profiles are stored in IndexedDB on this device. No cloud account,
            remote database or external AI service is required. Data is not
            encrypted by this extension. Websites receive only values you
            explicitly choose to fill.
          </p>
          <h3>Optional on-device AI</h3>
          <p>
            Standard extraction works offline without a model. On supported
            Chrome builds, you can enable the local Prompt API for ambiguous
            free-form documents. Chrome may download its model; documents and
            profile details remain on device. AI associations still require
            review. This setting lasts for this window only.
          </p>
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              prepareLocalModel(setNotice)
                .then(setIntelligence)
                .catch((e) => setNotice(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Prepare / enable on-device AI
          </button>
          {intelligence && (
            <button
              onClick={() => {
                setIntelligence(undefined);
                setNotice("Standard offline extraction selected.");
              }}
            >
              Use standard extraction
            </button>
          )}
          <h3>Website access</h3>
          <p>
            Active-tab access is used when you open the extension. Optional
            persistent access can be granted for the current hostname; it does
            not trigger automatic filling.
          </p>
          <button
            disabled={!tab?.url?.startsWith("http")}
            onClick={() => {
              if (!tab?.url) return;
              const origins = [portalPattern(tab.url)];
              chrome.permissions
                .request({ origins })
                .then((granted) => {
                  if (granted) {
                    setHosts((h) => [...new Set([...h, ...origins])]);
                    setNotice(
                      "Website access granted. Select a person to fill.",
                    );
                  } else setNotice("Website access was declined.");
                })
                .catch((e) => setNotice(e.message));
            }}
          >
            Allow on current website
          </button>
          {hosts.map((host) => (
            <div className="inline" key={host}>
              <span>{host}</span>
              <button
                onClick={() =>
                  run(async () => {
                    await chrome.permissions.remove({ origins: [host] });
                    setHosts((h) => h.filter((x) => x !== host));
                    setNotice(
                      "Persistent access removed. Refresh the website to clear an injected script.",
                    );
                  })
                }
              >
                Revoke
              </button>
            </div>
          ))}
          <h3>Local data controls</h3>
          <div className="inline">
            <button onClick={() => setConfirm("export")}>Export JSON</button>
            <button className="danger" onClick={() => setConfirm("clear")}>
              Delete all local data
            </button>
          </div>
          <p>
            Exported files contain personal information. Choose a private
            storage location. JSON exports can be reimported with duplicate
            review.
          </p>
        </section>
      )}
      {confirm && (
        <div role="dialog" aria-modal="true" className="confirm">
          <h3>
            {confirm === "export"
              ? "Export all profiles?"
              : confirm === "delete"
                ? `Delete ${selected ? personName(selected.fields) : "profile"}?`
                : "Delete all local profiles and import history?"}
          </h3>
          <p>
            {confirm === "export"
              ? "This downloads unencrypted personal information to your device."
              : "This cannot be undone. Export a backup first if needed."}
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (confirm === "delete" && selected) {
                  await db("DELETE", { id: selected.id });
                  setSelected(undefined);
                  setEditor(undefined);
                } else if (confirm === "clear") {
                  await db("CLEAR");
                  setSelected(undefined);
                  setRows([]);
                  setEditor(undefined);
                } else if (confirm === "export") {
                  const data = await db("EXPORT");
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(data, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "personal-assist-profiles.json";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
                setConfirm(undefined);
                setRefresh((x) => x + 1);
                setNotice("Operation completed.");
              })
            }
          >
            Confirm {confirm}
          </button>
          <button onClick={() => setConfirm(undefined)}>Cancel</button>
        </div>
      )}
      <footer>
        Local-first · No automatic submission · Select a profile before sharing
        details
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
