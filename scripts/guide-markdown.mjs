import { escapeHtml as esc } from '../public/lib/privacy.js';

export function safeHref(url) {
  if (/^(https?:\/\/|\/(?![/\\])|#)/i.test(url) && !/[\s\\\x00-\x1f]/.test(url)) return esc(url);
  return '';
}

export const stripComments = (text) => text.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\r\n]/g, ''));

const inlinePattern = /\[([^\]]+)\]\((https?:\/\/[^\s()]*(?:\([^\s()]*\)[^\s()]*)*|[^\s()]+)\)|(\*\*|__)(.+?)\3|(\*|_)(.+?)\5|`([^`]+)`/g;

function inline(line, links = true) {
  let result = '';
  let offset = 0;
  for (const match of line.matchAll(inlinePattern)) {
    const [raw, label, url, , bold, , italic, code] = match;
    result += esc(line.slice(offset, match.index));
    if (label) {
      const href = links && safeHref(url);
      result += href ? '<a href="' + href + '">' + inline(label, false) + '</a>' : esc(raw);
    } else if (bold) result += '<strong>' + inline(bold, links) + '</strong>';
    else if (italic) result += '<em>' + inline(italic, links) + '</em>';
    else result += '<code>' + esc(code) + '</code>';
    offset = match.index + raw.length;
  }
  return result + esc(line.slice(offset));
}

const heading = /^(#{1,6})\s+(.+)$/;
const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const caption = /^\*([^*].*?)\*$/;
const list = /^(\s*)([-+*]|\d+\.)\s+(.+)$/;
const rule = /^(---+|\*\*\*+)$/;
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
const table = (line, next) => line.includes('|') && cells(next ?? '').every((cell) => /^:?-{3,}:?$/.test(cell));

export function renderMarkdown(text, { imageInfo = () => ({}), warn = () => {} } = {}) {
  const lines = stripComments(text).split(/\r?\n/);
  let i = 0;
  const blocks = [];

  function readList() {
    const [, indent, marker] = list.exec(lines[i]);
    const tag = marker.endsWith('.') ? 'ol' : 'ul';
    const items = [];
    for (let row; (row = list.exec(lines[i] ?? ''));) {
      const [, space, bullet, item] = row;
      if (space.length !== indent.length || bullet.endsWith('.') !== (tag === 'ol')) break;
      i++;
      const nested = list.exec(lines[i] ?? '');
      const child = nested && nested[1].length > indent.length ? readList() : '';
      items.push('<li>' + inline(item) + child + '</li>');
    }
    const start = tag === 'ol' && marker !== '1.' ? ' start="' + Number.parseInt(marker, 10) + '"' : '';
    return '<' + tag + start + '>' + items.join('') + '</' + tag + '>';
  }

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const photo = image.exec(line);
    const head = heading.exec(line);
    if (photo) {
      const [, alt, url] = photo;
      const lineNumber = ++i;
      const legend = caption.exec(lines[i]?.trim() ?? '')?.[1] ?? '';
      if (legend) i++;
      if (!alt.trim()) warn(lineNumber, 'image has empty alt text: ' + url);
      if (/(^|\/)dindin-youtube-capture\.jpg$/.test(url) && !/<a href="https?:\/\//.test(inline(legend))) {
        warn(lineNumber, 'dindin-youtube-capture.jpg caption is missing a source link');
      }
      const { src, width, height, srcset } = imageInfo(url, lineNumber);
      const href = safeHref(src ?? url);
      if (!href) { blocks.push('<p>' + esc(line) + '</p>'); continue; }
      const dimensions = width && height ? ' width="' + width + '" height="' + height + '"' : '';
      const responsive = srcset ? ' srcset="' + esc(srcset) + '" sizes="(max-width: 800px) 100vw, 760px"' : '';
      blocks.push('<figure><img src="' + href + '" alt="' + esc(alt) + '" loading="lazy"' +
        dimensions + responsive + '>' + (legend ? '<figcaption>' + inline(legend) + '</figcaption>' : '') + '</figure>');
    } else if (head) {
      const level = Math.min(6, Math.max(2, head[1].length)); // J-5: 본문 ## → h2, ### → h3 (h1은 글 제목 하나뿐)
      blocks.push('<h' + level + '>' + inline(head[2]) + '</h' + level + '>');
      i++;
    } else if (rule.test(line)) {
      blocks.push('<hr>');
      i++;
    } else if (list.test(lines[i])) {
      blocks.push(readList());
    } else if (line.startsWith('>')) {
      const quote = [];
      while (lines[i]?.trimStart().startsWith('>')) quote.push(lines[i++].trimStart().slice(1).trim());
      blocks.push('<blockquote>' + renderMarkdown(quote.join('\n')) + '</blockquote>');
    } else if (table(line, lines[i + 1])) {
      const row = (text, tag) => '<tr>' + cells(text).map((cell) =>
        '<' + tag + '>' + inline(cell) + '</' + tag + '>').join('') + '</tr>';
      const header = row(line, 'th');
      i += 2;
      const rows = [];
      while (lines[i]?.trim() && lines[i].includes('|')) rows.push(row(lines[i++], 'td'));
      blocks.push('<div class="table-scroll"><table><thead>' + header + '</thead><tbody>' + rows.join('') + '</tbody></table></div>');
    } else {
      const paragraph = [line];
      i++;
      while (lines[i]?.trim() && ![heading, image, list, rule, /^>/].some((pattern) => pattern.test(lines[i].trim()))
        && !table(lines[i], lines[i + 1])) paragraph.push(lines[i++].trim());
      blocks.push('<p>' + inline(paragraph.join(' ')) + '</p>');
    }
  }
  return blocks;
}

export function jpegSize(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let offset = 2; offset < bytes.length;) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 8) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}
