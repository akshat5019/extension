import { extractResume } from "../resume.js";
import type { Extraction, IntelligenceService } from "./extraction";
export async function readDocument(
  file: File,
  onProgress: (message: string) => void,
  intelligence?: IntelligenceService,
): Promise<Extraction & { fingerprint: string }> {
  if (file.size > 25 * 1024 * 1024)
    throw new Error("Choose a document smaller than 25 MB.");
  const bytes = await file.arrayBuffer();
  const fingerprint = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const ext = file.name.split(".").at(-1)?.toLowerCase();
  onProgress("Reading document locally…");
  let text: string | undefined;
  const warnings: string[] = [];
  const nameHints: string[][] = [];
  if (["pdf", "docx"].includes(ext || ""))
    text = await extractResume(file, { warnings, onProgress, nameHints });
  if (intelligence && ["txt", "pdf", "docx"].includes(ext || "")) {
    onProgress("Interpreting person records with the on-device model…");
    const result = await intelligence.extract(
      text ?? new TextDecoder().decode(bytes),
    );
    return {
      ...result,
      warnings: [...warnings, ...result.warnings],
      fingerprint,
    };
  }
  const worker = new Worker(chrome.runtime.getURL("document-worker.js"));
  try {
    const result = await new Promise<Extraction>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              "Processing timed out. Split the document into smaller files.",
            ),
          ),
        120000,
      );
      worker.onmessage = ({ data }) => {
        if (data.progress) {
          onProgress(data.progress);
          return;
        }
        clearTimeout(timer);
        data.error ? reject(new Error(data.error)) : resolve(data.result);
      };
      worker.onerror = () => {
        clearTimeout(timer);
        reject(
          new Error(
            "Document processor failed. Try a smaller or text-based file.",
          ),
        );
      };
      worker.postMessage({ ext, text, bytes, nameHints }, [bytes]);
    });
    if (!result.candidates.length)
      throw new Error("No person records were found.");
    return {
      ...result,
      warnings: [...warnings, ...result.warnings],
      fingerprint,
    };
  } finally {
    worker.terminate();
  }
}
