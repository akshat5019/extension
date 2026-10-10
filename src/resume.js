import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import mammoth from "mammoth/mammoth.browser.js";
GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.mjs");

export async function extractResume(file, options = {}) {
  if (file.size > 25 * 1024 * 1024)
    throw new Error("Choose a document smaller than 25 MB.");
  const data = await file.arrayBuffer();
  const ext = file.name.split(".").at(-1).toLowerCase();
  let text;
  if (ext === "txt") text = new TextDecoder().decode(data);
  else if (ext === "docx") {
    const parsed = await mammoth.extractRawText({ arrayBuffer: data });
    text = parsed.value;
    for (const message of parsed.messages)
      options.warnings?.push(message.message);
  } else if (ext === "pdf") {
    const loading = getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true,
      cMapUrl: chrome.runtime.getURL("cmaps/"),
      cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL("standard_fonts/"),
      wasmUrl: chrome.runtime.getURL("wasm/"),
    });
    try {
      const pdf = await loading.promise;
      if (pdf.numPages > 200)
        throw new Error("Choose a document with 200 pages or fewer.");
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => item.str + (item.hasEOL ? "\n" : " "))
          .join("");
        if (!pageText.trim())
          options.warnings?.push(
            `PDF page ${i} has no accessible text and was skipped; OCR may be needed.`,
          );
        pages.push(pageText);
        options.onProgress?.(`Reading PDF page ${i} of ${pdf.numPages}…`);
      }
      text = pages.join("\n\f\n");
    } finally {
      await loading.destroy();
    }
  } else throw new Error("Please choose a PDF, DOCX or TXT file.");
  if (!text.trim())
    throw new Error(
      "No readable text found. For a scanned/image resume, use a text-based PDF, DOCX or TXT, or enter your details below.",
    );
  if (text.length > 2000000)
    throw new Error(
      "This document contains too much text. Split it into smaller files.",
    );
  return text;
}
