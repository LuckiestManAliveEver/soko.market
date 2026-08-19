import { normalizeOptionalText } from "./text-normalization";

export function parseCsvRecords(content: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const records = parseCsv(content).filter((row) => row.some((cell) => cell.trim().length > 0));

  if (records.length === 0) {
    return {
      headers: [],
      rows: []
    };
  }

  const headerRecord = records[0];

  if (headerRecord === undefined) {
    return {
      headers: [],
      rows: []
    };
  }

  const headers = headerRecord.map(
    (header, index) => normalizeOptionalText(header) || `column_${index + 1}`
  );
  const rows = records
    .slice(1)
    .map((record) =>
      Object.fromEntries(
        headers.map((header, index) => [header, normalizeOptionalText(record[index])])
      )
    );

  return {
    headers,
    rows
  };
}

export function parseFlexibleImportRecords(content: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    return {
      headers: [],
      rows: []
    };
  }

  const jsonRecords = parseJsonProductRecords(trimmed);

  if (jsonRecords !== null) {
    return jsonRecords;
  }

  const sqlRecords = parseSqlInsertRecords(trimmed);

  if (sqlRecords !== null && sqlRecords.rows.length > 0) {
    return sqlRecords;
  }

  if (trimmed.includes("\t")) {
    return parseDelimitedRecords(trimmed, "\t");
  }

  const csvRecords = parseCsvRecords(trimmed);

  if (csvRecords.headers.length > 1 || csvRecords.rows.length > 0) {
    return csvRecords;
  }

  return parseLooseProductLines(trimmed);
}

export function parseDelimitedRecords(
  content: string,
  delimiter: string
): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const records = content
    .split(/\r?\n/)
    .map((line) => line.split(delimiter).map((cell) => normalizeOptionalText(cell)))
    .filter((row) => row.some((cell) => cell.length > 0));
  const headerRecord = records[0] ?? [];
  const headers = headerRecord.map((header, index) => header || `column_${index + 1}`);
  const rows = records
    .slice(1)
    .map((record) =>
      Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""]))
    );

  return {
    headers,
    rows
  };
}

export function parseJsonProductRecords(content: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    const records = Array.isArray(parsed)
      ? parsed
      : isObjectRecord(parsed) && Array.isArray(parsed.products)
        ? parsed.products
        : null;

    if (records === null) {
      return null;
    }

    const rows = records
      .filter(isObjectRecord)
      .map((record) =>
        Object.fromEntries(
          Object.entries(record).map(([key, value]) => [key, value === null ? "" : String(value)])
        )
      );
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];

    return {
      headers,
      rows
    };
  } catch {
    return null;
  }
}

export function parseSqlInsertRecords(content: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} | null {
  const match = content.match(/insert\s+into\s+\S+\s*\(([^)]+)\)\s*values\s*([\s\S]+?);?$/i);

  if (match === null) {
    return null;
  }

  const headerSection = match[1];
  const valueSection = match[2];

  if (headerSection === undefined || valueSection === undefined) {
    return null;
  }

  const headers = headerSection.split(",").map((header) => normalizeSqlToken(header));
  const rowMatches = [...valueSection.matchAll(/\(([^()]*)\)/g)];
  const rows = rowMatches.map((rowMatch) => {
    const cells = parseCsv(rowMatch[1] ?? "").at(0) ?? [];
    return Object.fromEntries(
      headers.map((header, index) => [header, normalizeSqlToken(cells[index] ?? "")])
    );
  });

  return {
    headers,
    rows
  };
}

export function parseLooseProductLines(content: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const headers = ["name", "quantity", "unit", "sellingPrice"];
  const rows = content
    .split(/\r?\n/)
    .map((line) => normalizeOptionalText(line))
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line
        .split(/\s{2,}|\s+\|\s+|\s+-\s+|\s+,\s+/)
        .map((part) => normalizeOptionalText(part))
        .filter((part) => part.length > 0);
      const priceMatch = line.match(/(?:ksh|kes|usd|\$)?\s*(\d+(?:\.\d{1,2})?)\s*$/i);

      return {
        name: parts[0] ?? line,
        quantity: parts[1] ?? "0",
        unit: parts[2] ?? "unit",
        sellingPrice: parts[3] ?? priceMatch?.[1] ?? ""
      };
    });

  return {
    headers,
    rows
  };
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSqlToken(value: string): string {
  const trimmed = normalizeOptionalText(value).replace(/;$/, "");

  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`"))
  ) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  return trimmed;
}

export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

export function parseImportNumber(value: string): number | null {
  const normalized = normalizeOptionalText(value).replace(/[^0-9.-]/g, "");

  if (normalized.length === 0) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
