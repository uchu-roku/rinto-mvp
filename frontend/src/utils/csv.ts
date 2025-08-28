export function toCSV(rows: Record<string, any>[]): string {
if (!rows.length) return '';
const headers = Array.from(
rows.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set; }, new Set<string>())
);
const escape = (val: any) => {
if (val === null || val === undefined) return '';
const s = String(val);
if (s.includes('"') || s.includes(',') || s.includes('\n')) {
return '"' + s.replace(/"/g, '""') + '"';
}
return s;
};
const lines = [headers.join(',')];
for (const r of rows) {
lines.push(headers.map(h => escape(r[h])).join(','));
}
return lines.join('\n');
}


export function downloadText(filename: string, text: string) {
const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url; a.download = filename; a.style.display = 'none';
document.body.appendChild(a); a.click(); document.body.removeChild(a);
URL.revokeObjectURL(url);
}
