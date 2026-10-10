import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import mammoth from 'mammoth/mammoth.browser.js';
GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.mjs');

export async function extractResume(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a resume smaller than 10 MB.');
  const data = await file.arrayBuffer();
  const ext = file.name.split('.').at(-1).toLowerCase();
  let text;
  if (ext === 'txt') text = new TextDecoder().decode(data);
  else if (ext === 'docx') text = (await mammoth.extractRawText({ arrayBuffer: data })).value;
  else if (ext === 'pdf') {
    const loading = getDocument({ data, isEvalSupported: false, useSystemFonts: true, cMapUrl: chrome.runtime.getURL('cmaps/'), cMapPacked: true, standardFontDataUrl: chrome.runtime.getURL('standard_fonts/'), wasmUrl: chrome.runtime.getURL('wasm/') });
    try {
      const pdf = await loading.promise;
      if (pdf.numPages > 50) throw new Error('Choose a resume with 50 pages or fewer.');
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join(''));
      }
      text = pages.join('\n');
    } finally { await loading.destroy(); }
  } else throw new Error('Please choose a PDF, DOCX or TXT file.');
  if (!text.trim()) throw new Error('No readable text found. For a scanned/image resume, use a text-based PDF, DOCX or TXT, or enter your details below.');
  if (text.length > 250000) throw new Error('This document contains too much text. Choose a shorter resume.');
  return text;
}

