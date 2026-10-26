<script lang="ts">
  import { renderMarkdown } from '$lib/markdown/render';
  import { cn } from '$lib/utils';

  let { markdown, class: className = '' }: { markdown: string; class?: string } = $props();
  const html = $derived(renderMarkdown(markdown));
</script>

<div data-inbox-markdown class={cn('rendered-markdown inbox-markdown text-sm leading-6 text-fg', className)}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html html}
</div>

<style>
  :global(.inbox-markdown h1) {
    margin-bottom: 0.75rem;
    font-size: 1.25rem;
    font-weight: 650;
  }

  :global(.inbox-markdown h2) {
    margin-top: 1.25rem;
    margin-bottom: 0.375rem;
    font-size: 0.95rem;
    font-weight: 650;
  }

  :global(.inbox-markdown h2:first-child) {
    margin-top: 0;
  }
</style>
