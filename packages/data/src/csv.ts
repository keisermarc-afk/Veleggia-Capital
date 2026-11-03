/** Minimal RFC 4180 CSV parser: rows as objects keyed by the header, every cell as text. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; if (row.some(c => c !== '')) rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some(c => c !== '')) rows.push(row); }
  if (!rows.length) return [];
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, j) => [h, r[j] ?? ''])));
}

const quote = (v: string) => /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;

/** Write rows as CSV with the given column order (header first, \n line ends). */
export function toCsv(columns: readonly string[], rows: Record<string, string>[]): string {
  return [columns.join(','), ...rows.map(r => columns.map(c => quote(String(r[c] ?? ''))).join(','))].join('\n') + '\n';
}
