import { websiteTableSchema, type WebsiteTable } from "@interview/schemas";
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
const wrap = (value: string, width: number) => {
  const lines = [""];
  for (const word of value.split(/\s+/)) {
    if (lines.at(-1)!.length + word.length + 1 > width && lines.at(-1)) lines.push("");
    lines[lines.length - 1] += `${lines.at(-1) ? " " : ""}${word}`;
  }
  return lines;
};

/** Deterministic display of immutable website cells. No raw HTML or remote assets. */
export function renderWebsiteTable(input: WebsiteTable, sourceUrl: string) {
  const table = websiteTableSchema.parse(input);
  const occupied = table.rows.map(() => new Set<number>());
  const cells: Array<{cell: WebsiteTable["rows"][number][number]; row: number; col: number}> = [];
  let columns = 0;
  table.rows.forEach((row, r) => {
    let col = 0;
    row.forEach(cell => {
      while (occupied[r].has(col)) col++;
      if (col + cell.colSpan > 20 || r + cell.rowSpan > table.rows.length) throw new Error("Invalid website table spans");
      for (let y = r; y < r + cell.rowSpan; y++) for (let x = col; x < col + cell.colSpan; x++) {
        if (occupied[y].has(x)) throw new Error("Overlapping website table spans");
        occupied[y].add(x);
      }
      cells.push({cell,row:r,col}); col += cell.colSpan; columns = Math.max(columns,col);
    });
  });
  const widths = Array.from({length: columns}, (_v,i) => i ? 140 : 280);
  const width = widths.reduce((a,b)=>a+b,0) + 40;
  const x = (col: number) => 20 + widths.slice(0,col).reduce((a,b)=>a+b,0);
  const cellWidth = (col: number, span: number) => widths.slice(col,col+span).reduce((a,b)=>a+b,0);
  const titleLines = wrap(table.title, Math.floor((width-48)/10));
  const tableY = 35 + titleLines.length*24 + 20;
  const heights = table.rows.map(()=>36);
  for (const {cell,row,col} of cells) {
    const needed = wrap(cell.text, Math.floor((cellWidth(col,cell.colSpan)-16)/8)).length*18+16;
    const present = heights.slice(row,row+cell.rowSpan).reduce((a,b)=>a+b,0);
    if (needed > present) heights[row+cell.rowSpan-1] += needed-present;
  }
  const y = (row: number) => tableY+heights.slice(0,row).reduce((a,b)=>a+b,0);
  const body = cells.map(({cell,row,col}) => {
    const w = cellWidth(col,cell.colSpan), h = heights.slice(row,row+cell.rowSpan).reduce((a,b)=>a+b,0);
    const lines = wrap(cell.text,Math.floor((w-16)/8));
    return `<rect x="${x(col)}" y="${y(row)}" width="${w}" height="${h}" fill="${cell.header ? "#e8edf5" : row%2 ? "#f7f9fc" : "#fff"}" stroke="#c4cedd"/><text x="${x(col)+8}" y="${y(row)+22}" font-size="14" font-weight="${cell.header?600:400}">${lines.map((line,i)=>`<tspan x="${x(col)+8}" dy="${i?18:0}">${escape(line)}</tspan>`).join("")}</text>`;
  }).join("");
  let noteY = y(table.rows.length)+26;
  const notes = [...table.notes, `Table reproduced from ${sourceUrl}. Labels, values and notes are from the website.`].map(note => {
    const lines=wrap(note,Math.floor((width-48)/7)); const at=noteY; noteY+=lines.length*16+10;
    return `<text x="20" y="${at}" font-size="12">${lines.map((line,i)=>`<tspan x="20" dy="${i?16:0}">${escape(line)}</tspan>`).join("")}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${noteY+12}" viewBox="0 0 ${width} ${noteY+12}"><title>${escape(table.title)}</title><rect width="100%" height="100%" fill="white"/><g font-family="Arial, sans-serif" fill="#172d4b"><text x="20" y="32" font-size="20" font-weight="600">${titleLines.map((line,i)=>`<tspan x="20" dy="${i?24:0}">${escape(line)}</tspan>`).join("")}</text>${body}${notes}</g></svg>`;
}
