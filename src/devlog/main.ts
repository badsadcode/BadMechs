import './devlog.css';
import DEVLOG from '../../DEVLOG.md?raw';

/** Tiny markdown renderer: just enough for the devlog (headings, lists, tables, quotes, emphasis, code). */
function inline(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // images: repo paths under public/ are served from the site root
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => `<img src="${src.replace(/^public\//, '')}" alt="${alt}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function render(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  let inDay = false;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) {
      i++;
      continue;
    }
    if (l.startsWith('# ')) {
      out.push(`<header class="hero"><div class="stripes"></div><h1>${inline(l.slice(2))}</h1>`);
      i++;
      const sub: string[] = [];
      while (i < lines.length && !lines[i].startsWith('#') && !lines[i].startsWith('---')) sub.push(lines[i++]);
      out.push(`<div class="sub">${sub.filter((x) => x.trim()).map((x) => `<p>${inline(x)}</p>`).join('')}</div></header>`);
      continue;
    }
    if (l.startsWith('---')) {
      i++;
      continue;
    }
    if (l.startsWith('## ')) {
      if (inDay) out.push('</article>');
      out.push(`<article class="day"><h2>${inline(l.slice(3))}</h2>`);
      inDay = true;
      i++;
      continue;
    }
    if (l.startsWith('### ')) {
      out.push(`<h3>${inline(l.slice(4))}</h3>`);
      i++;
      continue;
    }
    if (l.startsWith('> ')) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote class="note">${inline(q.join(' '))}</blockquote>`);
      continue;
    }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(`<div class="table"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^[-*] /.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) items.push(lines[i++].slice(2));
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|>|\||[-*] |---)/.test(lines[i])) para.push(lines[i++]);
    const text = para.join(' ');
    const mood = /^\*Mood:/.test(text);
    out.push(`<p${mood ? ' class="mood"' : ''}>${inline(text)}</p>`);
  }
  if (inDay) out.push('</article>');
  return out.join('\n');
}

document.body.innerHTML = `<nav class="top"><a href="./">← back to the garage (BadMech)</a></nav><main>${render(DEVLOG)}</main><footer>Bad Ideas Works · We Create Worlds. Badly.</footer>`;
