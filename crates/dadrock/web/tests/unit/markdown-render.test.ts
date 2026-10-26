import { describe, expect, it } from 'vitest';
import { renderMarkdown, stripFrontMatter } from '../../src/lib/markdown/render';

// markdown-it puts newlines between block tags, ends code blocks with one, and keeps soft
// line breaks; collapse them.
function render(markdown: string): string {
  return renderMarkdown(markdown)
    .replace(/\n<\/code>/g, '</code>')
    .replace(/>\n+</g, '><')
    .replace(/\n/g, ' ')
    .trim();
}

describe('stripFrontMatter', () => {
  it('removes a leading YAML front matter block', () => {
    expect(stripFrontMatter('---\ntitle: Use Polars\n---\n\n# Use Polars\n\nBody')).toBe(
      '# Use Polars\n\nBody',
    );
  });

  it('leaves ordinary markdown untouched', () => {
    expect(stripFrontMatter('# Heading\n\nBody')).toBe('# Heading\n\nBody');
  });
});

describe('renderMarkdown', () => {
  it('renders headings, lists, inline code, links, and wikilinks', () => {
    const html = renderMarkdown(
      '# Decision\n\nUse `polars` with [[0193fb1fa3a0|the data decision]].\n\n- fast\n- typed\n\n[docs](https://pola.rs)',
    );

    expect(html).toContain('<h1>Decision</h1>');
    expect(html).toContain('<code>polars</code>');
    expect(html).toContain('data-wikilink="0193fb1fa3a0"');
    expect(html).toContain('<li>fast</li>');
    expect(html).toContain('href="https://pola.rs"');
  });

  it('renders only short-id and full-id wikilinks as record links', () => {
    const html = renderMarkdown(
      'See [[0193fb1f-a3a0-7abc-8def-0123456789ab]], [[Reading list]], and [[cafe]].',
    );

    expect(html).toContain('data-wikilink="0193fb1f-a3a0-7abc-8def-0123456789ab"');
    expect(html).toContain('[[Reading list]]');
    expect(html).toContain('[[cafe]]');
    expect(html.match(/data-wikilink/g)).toHaveLength(1);
  });

  it('escapes raw HTML before applying inline markdown', () => {
    const html = renderMarkdown('Do not run <script>alert("x")</script>.');

    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders unsafe link schemes as inert text', () => {
    const html = renderMarkdown(
      '[one](javascript:alert(1)) [two](JaVaScRiPt:alert(2)) [three](%6a%61vascript:alert(3)) [four](data:text/html,test)',
    );

    expect(html).not.toContain('<a href="javascript:');
    expect(html).not.toContain('<a href="JaVaScRiPt:');
    expect(html).not.toContain('<a href="%6a%61vascript:');
    expect(html).not.toContain('<a href="data:');
    expect(html).toContain('[one](javascript:alert(1))');
    expect(html).toContain('[four](data:text/html,test)');
  });

  it('renders emphasis and strikethrough', () => {
    expect(render('**bold**, *italic*, _under_, and ~~struck~~')).toBe(
      '<p><strong>bold</strong>, <em>italic</em>, <em>under</em>, and <s>struck</s></p>',
    );
  });

  it('renders ordered, nested, and wrapped lists', () => {
    expect(render('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>');
    expect(render('- a\n  - b\n+ c')).toBe(
      '<ul><li>a <ul><li>b</li></ul></li></ul><ul><li>c</li></ul>',
    );
    expect(render('- item one\n  wraps here\n\nnext')).toBe(
      '<ul><li>item one wraps here</li></ul><p>next</p>',
    );
  });

  it('renders tables', () => {
    expect(render('| Model | AIC |\n|---|--:|\n| OLS | `412` |')).toBe(
      '<table><thead><tr><th>Model</th><th style="text-align:right">AIC</th></tr></thead>' +
        '<tbody><tr><td>OLS</td><td style="text-align:right"><code>412</code></td></tr></tbody></table>',
    );
  });

  it('renders deeper headings, rules, and hard breaks', () => {
    expect(render('#### Four\n\n---\n\nline one  \nline two')).toBe(
      '<h4>Four</h4><hr><p>line one<br> line two</p>',
    );
  });

  it('renders images and autolinks with safe URLs only', () => {
    expect(render('![Residuals](figures/residuals.png)')).toBe(
      '<p><img src="figures/residuals.png" alt="Residuals"></p>',
    );
    expect(render('<https://pola.rs>')).toBe(
      '<p><a href="https://pola.rs" target="_blank" rel="noreferrer">https://pola.rs</a></p>',
    );

    const unsafe = render('![x](javascript:alert(1)) <javascript:alert(2)>');
    expect(unsafe).not.toContain('<img');
    expect(unsafe).not.toContain('<a href');
  });

  it('keeps links and record links literal inside code spans', () => {
    expect(render('`[x](https://pola.rs)` and `[[0193fb1fa3a0]]`')).toBe(
      '<p><code>[x](https://pola.rs)</code> and <code>[[0193fb1fa3a0]]</code></p>',
    );
  });

  it('renders formatting inside record link labels as text', () => {
    expect(render('[[0193fb1fa3a0|**the** data decision]]')).toBe(
      '<p><button class="wikilink" type="button" data-wikilink="0193fb1fa3a0">**the** data decision</button></p>',
    );
  });

  describe('blockquotes', () => {
    it('joins consecutive `>` lines, with or without a space after the marker', () => {
      expect(render('> one\n>two\n   > three')).toBe(
        '<blockquote><p>one two three</p></blockquote>',
      );
    });

    it('separates paragraphs inside a quote with an empty `>` line', () => {
      expect(render('> one\n>\n> two')).toBe('<blockquote><p>one</p><p>two</p></blockquote>');
    });

    it('ends a quote at a blank line', () => {
      expect(render('> one\n\n> two\n\nafter')).toBe(
        '<blockquote><p>one</p></blockquote><blockquote><p>two</p></blockquote><p>after</p>',
      );
    });

    it('continues an open paragraph lazily on lines without `>`', () => {
      expect(render('> one\ntwo\n\nafter')).toBe(
        '<blockquote><p>one two</p></blockquote><p>after</p>',
      );
    });

    it('does not continue lazily with a line that starts another block', () => {
      expect(render('> one\n- item')).toBe(
        '<blockquote><p>one</p></blockquote><ul><li>item</li></ul>',
      );
      expect(render('> one\n## Heading')).toBe(
        '<blockquote><p>one</p></blockquote><h2>Heading</h2>',
      );
      expect(render('> # Heading\nafter')).toBe(
        '<blockquote><h1>Heading</h1></blockquote><p>after</p>',
      );
    });

    it('interrupts a paragraph and a list', () => {
      expect(render('before\n> quote\n- item\n> quote')).toBe(
        '<p>before</p><blockquote><p>quote</p></blockquote><ul><li>item</li></ul><blockquote><p>quote</p></blockquote>',
      );
    });

    it('renders nested quotes', () => {
      expect(render('> outer\n>\n> > inner\n>> more\nlazy\n\nafter')).toBe(
        '<blockquote><p>outer</p><blockquote><p>inner more lazy</p></blockquote></blockquote><p>after</p>',
      );
    });

    it('renders block and inline formatting inside a quote', () => {
      const html = render(
        [
          '> ## Note',
          '> - first',
          '> - second',
          '>',
          '> Use `polars` per [[0193fb1fa3a0|the data decision]] and [docs](https://pola.rs).',
          '>',
          '> ```',
          '> > not a quote',
          '> ```',
        ].join('\n'),
      );

      expect(html).toBe(
        '<blockquote><h2>Note</h2><ul><li>first</li><li>second</li></ul>' +
          '<p>Use <code>polars</code> per <button class="wikilink" type="button" data-wikilink="0193fb1fa3a0">the data decision</button>' +
          ' and <a href="https://pola.rs" target="_blank" rel="noreferrer">docs</a>.</p>' +
          '<pre><code>&gt; not a quote</code></pre></blockquote>',
      );
    });

    it('keeps `>` lines inside a fenced code block literal', () => {
      expect(render('```\n> literal\n```')).toBe('<pre><code>&gt; literal</code></pre>');
    });

    it('does not continue a fenced code block inside a quote lazily', () => {
      expect(render('> ```\n> code\nafter')).toBe(
        '<blockquote><pre><code>code</code></pre></blockquote><p>after</p>',
      );
    });

    it('escapes raw HTML and keeps unsafe links inert inside a quote', () => {
      const html = render(
        '> <script>alert("x")</script>\n> <img src=x onerror=alert(1)>\n>\n> > [link](javascript:alert(1))',
      );

      expect(html).toBe(
        '<blockquote><p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt;</p>' +
          '<blockquote><p>[link](javascript:alert(1))</p></blockquote></blockquote>',
      );
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<a href');
    });

    it('caps nesting depth so hostile input cannot exhaust the stack', () => {
      const html = render(`${'>'.repeat(10_000)} deep`);

      expect(html.match(/<blockquote>/g)!.length).toBeLessThanOrEqual(100);
    });

    it('renders the candidate-review demo record open question as a quote', () => {
      const body = [
        '## Context',
        '',
        'Island may confound species differences because species are not evenly distributed.',
        '',
        '## Decision',
        '',
        'Candidate: add island fixed effects to the OLS model.',
        '',
        '## Alternatives',
        '',
        'Keep the compact formula for the first demo.',
        '',
        '## Consequences',
        '',
        'This is low confidence because the screencast may not need that complexity.',
        '',
        '## Open questions',
        '',
        '> Should this be a robustness check rather than the main model?',
        '',
      ].join('\n');
      const html = render(body);

      expect(html).toContain(
        '<h2>Open questions</h2><blockquote><p>Should this be a robustness check rather than the main model?</p></blockquote>',
      );
      expect(html).not.toContain('&gt;');
    });

    it('renders the documentation example decision as one quoted paragraph', () => {
      const html = render(
        '## Decision\n\n> #axis/sample/complete-case\n> Drop the 47 respondents without recorded treatment assignment from\n> the analysis sample.\n\n## Alternatives',
      );

      expect(html).toBe(
        '<h2>Decision</h2><blockquote><p>#axis/sample/complete-case Drop the 47 respondents without recorded treatment assignment from the analysis sample.</p></blockquote><h2>Alternatives</h2>',
      );
    });
  });
});
