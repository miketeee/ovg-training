// md.js — a small Markdown renderer for the guide files.
// Handles what the guide uses: headings, paragraphs, lists (2 levels), tables,
// block quotes, rules, code, **bold**, *italic*, `code`, links, and
// picture placeholders: [PLACEHOLDER: <id> — "<caption>" illustration, p. N](link)
// All text is escaped first, so nothing in a file can run as code.

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function slug(text) {
  return String(text).toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'section';
}

const PLACEHOLDER = /!?\[PLACEHOLDER: ([^\s\]]+) — "([^"]+)" illustration, pp?\. (\d+)(?:[–-]\d+)?\]\(([^)]*)\)/g;

/** Every picture placeholder in a file: [{ id, caption, page }] */
export function placeholders(text) {
  const out = [];
  for (const m of String(text).matchAll(PLACEHOLDER)) out.push({ id: m[1], caption: m[2], page: Number(m[3]) });
  return out;
}

function inline(raw) {
  // Pull out code spans and placeholders before escaping, so their contents stay intact.
  const keep = [];
  const stash = html => `\u0000${keep.push(html) - 1}\u0000`;
  let s = String(raw)
    .replace(PLACEHOLDER, (_, id, cap, page) =>
      stash(`<span class="fig-slot" data-ex="${esc(id)}" data-cap="${esc(cap)}" data-page="${esc(page)}"></span>`))
    .replace(/`([^`]+)`/g, (_, code) => {
      const file = code.match(/^(\d\d-[a-z0-9-]+\.md)(?:\s*(§.*))?$/);
      return stash(file
        ? `<a class="xref" href="#/guide/${encodeURIComponent(file[1])}">${esc(code)}</a>`
        : `<code>${esc(code)}</code>`);
    });
  s = esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
      const h = href.replace(/&amp;/g, '&');
      if (/^\d\d-[a-z0-9-]+\.md(#.*)?$/.test(h)) return `<a href="#/guide/${h.replace('#', '/')}">${text}</a>`;
      if (/^https?:\/\//.test(h)) return `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      return text; // anything else (e.g. DRIVE_LINK_PENDING) shows as plain text
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^\s*](?:[^*]*[^\s*])?)\*(?!\*)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i]);
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1); // a trailing \| is a real pipe
  return s.replace(/\\\|/g, '\u0001').split('|').map(c => c.trim().replace(/\u0001/g, '|'));
}

/**
 * Render Markdown to HTML.
 * Returns { html, toc: [{ level, text, id }] }
 */
export function render(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [], toc = [], used = new Set();
  let i = 0;

  const headingId = t => { let id = slug(t), n = 2; while (used.has(id)) id = `${slug(t)}-${n++}`; used.add(id); return id; };
  const isBlockStart = l => /^(#{1,6}\s|>\s?|```|\s*([-*+]|\d+\.)\s|\|)/.test(l) || /^-{3,}\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const level = m[1].length, html = inline(m[2]), id = headingId(m[2]);
      if (level >= 2 && level <= 3) toc.push({ level, text: html, id });
      out.push(`<h${Math.min(level + 1, 6)} id="${id}">${html}</h${Math.min(level + 1, 6)}>`); // file "#" → page h2 (the page h1 is the title)
      i++; continue;
    }
    if (/^-{3,}\s*$/.test(line) || /^\*{3,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    if (line.startsWith('```')) {
      const buf = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${render(buf.join('\n')).html}</blockquote>`);
      continue;
    }

    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map(c => (c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      const cell = (tag, c, j) => `<${tag}${align[j] ? ` style="text-align:${align[j]}"` : ''}>${inline(c)}</${tag}>`;
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c, j) => cell('th', c, j)).join('')}</tr></thead><tbody>${
        rows.map(r => `<tr>${head.map((_, j) => cell('td', r[j] ?? '', j)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      // Collect the whole list (items, nested items, and wrapped lines).
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const im = l.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (im) { items.push({ indent: im[1].replace(/\t/g, '    ').length, ordered: /\d/.test(im[2]), start: parseInt(im[2], 10), text: im[3] }); i++; continue; }
        if (l.trim() && /^\s+/.test(l) && items.length && !isBlockStart(l.trim())) { items[items.length - 1].text += ' ' + l.trim(); i++; continue; }
        if (!l.trim() && i + 1 < lines.length && /^\s*([-*+]|\d+\.)\s/.test(lines[i + 1])) { i++; continue; }
        break;
      }
      out.push(renderList(items));
      continue;
    }

    // Paragraph: until a blank line or another block.
    const buf = [line.trim()]; i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) buf.push(lines[i++].trim());
    const p = buf.join(' ');
    // A paragraph that is only a picture becomes a block figure.
    out.push(/^!?\[PLACEHOLDER:[^\]]+\]\([^)]*\)$/.test(p) ? `<div class="fig-block">${inline(p)}</div>` : `<p>${inline(p)}</p>`);
  }
  return { html: out.join('\n'), toc };
}

function renderList(items) {
  // Build nested lists from indentation (any deeper indent = one level deeper).
  let html = '';
  const stack = []; // { indent, tag }
  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul';
    while (stack.length && it.indent < stack[stack.length - 1].indent) { html += `</li></${stack.pop().tag}>`; }
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) {
      stack.push({ indent: it.indent, tag });
      html += `<${tag}${tag === 'ol' && it.start > 1 ? ` start="${it.start}"` : ''}><li>`;
    } else {
      if (top.tag !== tag) { html += `</li></${stack.pop().tag}><${tag}><li>`; stack.push({ indent: it.indent, tag }); }
      else html += '</li><li>';
    }
    html += inline(it.text);
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

/** First "# " heading, without the leading "NN — " number. */
export function titleOf(text, fallback) {
  const m = String(text).match(/^#\s+(.+)$/m);
  return m ? m[1].replace(/^\d+\s*[—–-]\s*/, '').trim() : fallback;
}
