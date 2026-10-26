import MarkdownIt from 'markdown-it';
import type { PluginSimple } from 'markdown-it';

export function stripFrontMatter(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') return markdown;

  const end = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (end < 0) return markdown;

  return lines
    .slice(end + 2)
    .join('\n')
    .replace(/^\n/, '');
}

export function renderMarkdown(markdown: string): string {
  return markdownIt.render(markdown);
}

// Only short-id and full-id targets are DADR record links; other wikilinks stay as text.
const RECORD_LINK =
  /^\[\[\s*([0-9a-fA-F]{12}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*(?:\|([^\]]+))?\]\]/;

const recordLinks: PluginSimple = (md) => {
  md.inline.ruler.before('link', 'record_link', (state, silent) => {
    if (!state.src.startsWith('[[', state.pos)) return false;
    const match = RECORD_LINK.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) {
      const token = state.push('record_link', 'button', 0);
      token.meta = { target: match[1]!, label: match[2] };
    }
    state.pos += match[0].length;
    return true;
  });

  md.renderer.rules.record_link = (tokens, index) => {
    const { target, label } = tokens[index]!.meta as {
      target: string;
      label?: string;
    };
    return `<button class="wikilink" type="button" data-wikilink="${escapeAttr(target)}">${escapeHtml(
      label || target,
    )}</button>`;
  };
};

// Raw HTML stays escaped, and links and images only render for safe URLs; anything
// else stays literal text. GFM tables and strikethrough come with the default preset.
const markdownIt = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
}).use(recordLinks);
markdownIt.validateLink = isSafeLinkUrl;
markdownIt.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index]!.attrSet('target', '_blank');
  tokens[index]!.attrSet('rel', 'noreferrer');
  return self.renderToken(tokens, index, options);
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

function isSafeLinkUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return true;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) return true;

  const normalized = decodedSchemeCandidate(trimmed).toLowerCase();
  const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/);
  if (scheme) {
    return ['http', 'https', 'mailto'].includes(scheme[1]!);
  }

  return !trimmed.startsWith('//');
}

function decodedSchemeCandidate(url: string): string {
  // eslint-disable-next-line no-control-regex -- Strip leading controls that can conceal an unsafe URL scheme.
  let candidate = url.replace(/^[\u0000- \u007f]+/, '');
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    } catch {
      break;
    }
  }
  // eslint-disable-next-line no-control-regex -- Strip decoded controls before checking URL scheme safety.
  return candidate.replace(/[\u0000- \u007f]+/g, '');
}
