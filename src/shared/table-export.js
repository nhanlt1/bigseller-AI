function escapeCsvCell(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s))
        return `"${s.replace(/"/g, '""')}"`;
    return s;
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {{ key: string, label: string }[]} columns
 */
export function rowsToTsv(rows, columns) {
    const header = columns.map((c) => c.label).join('\t');
    const lines = rows.map((row) =>
        columns.map((c) => String(row[c.key] ?? '')).join('\t'),
    );
    return [header, ...lines].join('\n');
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {{ key: string, label: string }[]} columns
 */
export function rowsToCsv(rows, columns) {
    const header = columns.map((c) => escapeCsvCell(c.label)).join(',');
    const lines = rows.map((row) =>
        columns.map((c) => escapeCsvCell(row[c.key])).join(','),
    );
    return [header, ...lines].join('\r\n');
}

export async function copyTableToClipboard(rows, columns) {
    const tsv = rowsToTsv(rows, columns);
    await navigator.clipboard.writeText(tsv);
    return tsv;
}

export function downloadCsv(rows, columns, filename = 'export.csv') {
    const csv = '\uFEFF' + rowsToCsv(rows, columns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
