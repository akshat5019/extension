import { extractCSV, extractPeople, rowsToRecords } from "./core/extraction";
import { cleanFields, type Fields } from "./core/model";
self.onmessage = async ({ data }) => {
  try {
    const { ext, bytes } = data;
    let result;
    self.postMessage({ progress: "Separating and validating person records…" });
    if (ext === "xlsx") {
      const { default: ExcelJS } = await import("exceljs");
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes);
      const candidates = [];
      const warnings = [];
      for (const sheet of book.worksheets) {
        if (sheet.rowCount > 10001)
          throw new Error(
            "A sheet has more than 10,000 rows. Split the workbook.",
          );
        const rows: unknown[][] = [];
        sheet.eachRow({ includeEmpty: false }, (row) => {
          const values: unknown[] = [];
          row.eachCell({ includeEmpty: true }, (cell, index) => {
            values[index - 1] =
              cell.type === ExcelJS.ValueType.Date
                ? (cell.value as Date).toISOString().slice(0, 10)
                : cell.text;
          });
          rows.push(values);
        });
        if (rows.length < 2) continue;
        const parsed = rowsToRecords(rows);
        candidates.push(...parsed.candidates);
        warnings.push(...parsed.warnings.map((x) => `${sheet.name}: ${x}`));
      }
      result = { candidates, warnings };
    } else if (ext === "docx" && data.text === undefined) {
      self.postMessage({ progress: "Reading Word document locally…" });
      const { extractResume } = await import("./resume.js");
      const warnings: string[] = [];
      const text = await extractResume(
        { name: data.name, size: bytes.byteLength },
        { bytes, warnings },
      );
      const extracted = extractPeople(text);
      result = { ...extracted, warnings: [...warnings, ...extracted.warnings] };
    } else if (ext === "json") {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      const rows = Array.isArray(parsed) ? parsed : parsed.profiles;
      if (!Array.isArray(rows))
        throw new Error("JSON must contain a profiles array.");
      result = {
        candidates: rows.map((p: Fields, i: number) => ({
          fields: cleanFields(p.fields || p),
          record: i + 1,
          warnings: [],
        })),
        warnings: [
          "Exported IDs are not reused on import; duplicates require review.",
        ],
      };
    } else if (ext === "csv")
      result = extractCSV(new TextDecoder().decode(bytes));
    else if (ext === "txt" || ext === "pdf" || ext === "docx")
      result = extractPeople(
        data.text ?? new TextDecoder().decode(bytes),
        data.nameHints || [],
      );
    else
      throw new Error(
        "Supported formats: PDF, DOCX, TXT, CSV, XLSX and JSON. Scanned documents need OCR, which is not bundled in this version.",
      );
    if (result.candidates.length > 10000)
      throw new Error("Import at most 10,000 people at once.");
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : "Could not process document.",
    });
  }
};
