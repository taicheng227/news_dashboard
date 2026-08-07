export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function inline(value) {
  let text = escapeHtml(value);
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  return text;
}

export function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const html = [];
  let paragraph = [];
  let listOpen = false;
  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (listOpen) html.push('</ul>');
    listOpen = false;
  };
  for (const line of lines) {
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const list = line.match(/^[-*]\s+(.+)$/);
    if (heading) {
      flushParagraph(); closeList();
      const level = Math.min(heading[1].length + 1, 5);
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (list) {
      flushParagraph();
      if (!listOpen) { html.push('<ul>'); listOpen = true; }
      html.push(`<li>${inline(list[1])}</li>`);
    } else if (/^---+$/.test(line.trim())) {
      flushParagraph(); closeList(); html.push('<hr>');
    } else if (!line.trim()) {
      flushParagraph(); closeList();
    } else {
      paragraph.push(line.trim());
    }
  }
  flushParagraph(); closeList();
  return html.join('\n');
}
