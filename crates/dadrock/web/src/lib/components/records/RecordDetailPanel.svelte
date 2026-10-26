<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Check, History, Pencil, Replace, Sparkles, X } from 'lucide-svelte';
  import { untrack } from 'svelte';
  import { createApi, type MutationResponse, type RecordSource } from '$lib/api';
  import { hasMissingRationale } from '$lib/candidates/review';
  import MarkdownEditor from '$lib/components/editor/MarkdownEditor.svelte';
  import { Alert, Badge, Button, InlineLinkBadge, SegmentedTabs } from '$lib/components/ui';
  import { ActionBar, DocumentPane, MetadataStrip } from '$lib/components/workbench';
  import { versionEdits } from '$lib/history/edits';
  import { currentVersions } from '$lib/history/layout';
  import { candidateItemId } from '$lib/inbox/items';
  import { renderMarkdown, stripFrontMatter } from '$lib/markdown/render';
  import { inboxUrl, ledgerRecordUrl, ledgerUrl } from '$lib/navigation/routes';
  import { applyMutationResponse } from '$lib/query/mutation-cache';
  import { detailActionRecord, detailActions, successorDraft, type DetailSurface } from '$lib/records/detail-state';
  import {
    initialRecordEditorState,
    isRecordEditorDirty,
    syncRecordEditorSource,
  } from '$lib/records/editor-state';
  import { displayRecordStatus, recordStatusVariant } from '$lib/records/filters';
  import { composer } from '$lib/stores/composer.svelte';
  import { toasts } from '$lib/stores/toast.svelte';
  import RecordHistory from './RecordHistory.svelte';
  import StaleSupersedesNotice from './StaleSupersedesNotice.svelte';
  import SuccessorChanges from './SuccessorChanges.svelte';

  type StatusVariant = 'candidate' | 'accepted' | 'rejected' | 'superseded';
  type View = 'changes' | 'document' | 'history';

  let {
    id,
    surface,
    embedded = false,
  }: {
    id: string;
    /** The Inbox reviews candidates; the Ledger reads and supersedes decisions. */
    surface: DetailSurface;
    /** True when the panel sits inside a split pane and should scroll internally. */
    embedded?: boolean;
  } = $props();

  const api = createApi();
  const queryClient = useQueryClient();

  // Query functions read the id from their key, not from the `id` prop: when
  // the Inbox moves on to the next item, a refetch of this panel's queries can
  // still run after the prop has changed, and must not store the next
  // record's data under this record's key.
  const source = createQuery(() => ({
    queryKey: ['record-source', id],
    queryFn: ({ queryKey }) => api.getRecordSource(String(queryKey[1])),
    enabled: Boolean(id),
  }));

  const lifecycle = createQuery(() => ({
    queryKey: ['record-lifecycle', id],
    queryFn: ({ queryKey }) => api.getRecordLifecycle(String(queryKey[1])),
    enabled: Boolean(id),
  }));

  const snapshot = createQuery(() => ({
    queryKey: ['snapshot'],
    queryFn: () => api.getSnapshot(),
  }));

  let editorState = $state(initialRecordEditorState());
  let editing = $state(false);
  let chosenView = $state<View | null>(null);

  const dirty = $derived(isRecordEditorDirty(editorState));
  const renderedHtml = $derived(source.data ? renderMarkdown(stripFrontMatter(source.data.content)) : '');

  const record = $derived(detailActionRecord(lifecycle.data?.record, snapshot.data?.records));
  const status = $derived(record ? displayRecordStatus(record) : 'accepted');
  const isCandidate = $derived(status === 'candidate');
  const agentAvailable = $derived(snapshot.data?.settings.agent_available ?? false);
  const actions = $derived(detailActions({ surface, status, agentAvailable }));
  const pending = $derived(isCandidate ? (lifecycle.data?.pending_supersedes ?? []) : []);
  const stale = $derived(isCandidate ? (lifecycle.data?.stale_supersedes ?? []) : []);

  // The Ledger shows every decided record's history; the Inbox does not.
  const showHistory = $derived(surface === 'ledger' && Boolean(record) && !isCandidate);
  const history = createQuery(() => ({
    queryKey: ['record-history', id],
    queryFn: ({ queryKey }) => api.getRecordHistory(String(queryKey[1]), { patch: true }),
    enabled: Boolean(id) && (showHistory || status === 'superseded'),
  }));

  /** The opened version's text edits since it was accepted or rejected, from Git. */
  const edits = $derived(versionEdits(history.data?.versions.find((version) => version.id === id)));
  const editedLabel = $derived(status === 'rejected' ? 'Edited since rejection' : 'Edited since acceptance');

  /** Where the decision went: the versions now in force in place of this one. */
  const supersededBy = $derived.by(() => {
    if (status !== 'superseded') return [];
    const tips = history.data ? currentVersions(history.data).filter((version) => version.id !== id) : [];
    return tips.length ? tips : (lifecycle.data?.successors ?? []);
  });

  const views = $derived.by((): Array<{ value: View; label: string; count?: number }> => {
    if (surface === 'inbox' && pending.length) {
      return [
        { value: 'changes', label: 'Changes' },
        { value: 'document', label: 'Document' },
      ];
    }
    if (showHistory) {
      const versions = history.data?.versions.length;
      return [
        { value: 'document', label: 'Document' },
        versions ? { value: 'history', label: 'History', count: versions } : { value: 'history', label: 'History' },
      ];
    }
    return [];
  });
  const view = $derived<View>(
    chosenView && views.some((option) => option.value === chosenView) ? chosenView : (views[0]?.value ?? 'document'),
  );

  // Links from Inbox issues open the editor with `tab=edit`, and `tab=history`
  // opens the History view; the Inbox itself never uses the URL.
  const requestedTab = $derived(surface === 'ledger' ? page.url.searchParams.get('tab') : null);

  $effect(() => {
    const tab = requestedTab;
    void id;
    untrack(() => {
      editing = tab === 'edit';
      chosenView = tab === 'history' ? 'history' : null;
    });
  });

  $effect(() => {
    if (source.data) {
      const nextState = syncRecordEditorSource(editorState, source.data);
      if (nextState !== editorState) {
        editorState = nextState;
      }
    }
  });

  const save = createMutation(() => ({
    mutationFn: (content: string) => api.saveRecordSource(id, content),
    onSuccess: async (response) => {
      const savedContent = editorState.editor;
      queryClient.setQueryData<RecordSource>(['record-source', id], (current) =>
        current ? { ...current, content: savedContent } : current,
      );
      editorState.cleanContent = savedContent;
      editorState.saveMessage = response.message;
      toasts.push({ severity: 'success', message: response.message });
      await applyMutationResponse(queryClient, response);
      leaveEditMode();
    },
  }));

  const accept = createMutation(() => ({
    mutationFn: () => api.acceptCandidate(id),
    onSuccess: (response) => finishCandidateAction(response, 'accepted'),
  }));

  const reject = createMutation(() => ({
    mutationFn: () => api.rejectCandidate(id),
    onSuccess: (response) => finishCandidateAction(response, 'rejected'),
  }));

  function fileName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  function recordHref(recordId: string) {
    return embedded && surface === 'ledger'
      ? ledgerUrl({ id: recordId, archived: true })
      : ledgerRecordUrl(recordId);
  }

  function revise() {
    if (actions.revise === 'edit-record') composer.show({ mode: 'revise', recordIds: [id] });
    else if (actions.revise === 'supersede-record') composer.show(successorDraft('revise', id));
  }

  function leaveEditMode() {
    editing = false;
    if (surface !== 'ledger' || !page.url.searchParams.has('tab')) return;
    const next = new URL(page.url);
    next.searchParams.delete('tab');
    void goto(resolve(`${next.pathname}${next.search}` as '/ledger'), {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
    });
  }

  function resetEditor() {
    editorState.editor = editorState.cleanContent;
    editorState.saveMessage = '';
    leaveEditMode();
  }

  function saveEditor() {
    if (!dirty || save.isPending) return;
    editorState.saveMessage = '';
    save.mutate(editorState.editor);
  }

  async function finishCandidateAction(response: MutationResponse, outcome: string) {
    toasts.push({ severity: 'success', message: response.message, detail: `Candidate ${outcome}.` });
    await applyMutationResponse(queryClient, response);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!editing) return;
    if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === 's' || event.code === 'KeyS')) {
      event.preventDefault();
      saveEditor();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if !id}
  <Alert variant="neutral">Select a decision to read it.</Alert>
{:else if source.isPending || lifecycle.isPending}
  <p class="text-sm text-fg-muted">Loading record...</p>
{:else if source.isError || lifecycle.isError}
  <Alert variant="danger" title="Failed to load record">
    {source.error?.message ?? lifecycle.error?.message ?? 'Unknown record loading error'}
  </Alert>
{:else if source.data && lifecycle.data && record}
  <div data-record-detail-header class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant={recordStatusVariant(record) as StatusVariant} mono class="uppercase">
          {status.slice(0, 3)}
        </Badge>
        <svelte:element
          this={embedded ? 'h2' : 'h1'}
          class={embedded ? 'text-xl font-semibold' : 'text-2xl font-semibold'}
        >
          {record.title}
        </svelte:element>
      </div>
      <div class="mt-2">
        <div class="flex flex-wrap items-center gap-2">
          <Badge mono>{fileName(record.path)}</Badge>
          {#if edits.length}
            {#if views.some((option) => option.value === 'history')}
              <button
                type="button"
                data-record-edited
                class="inline-flex h-5 items-center gap-1 rounded-md border border-border px-1.5 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-60"
                title="Show the edits in History"
                disabled={editing}
                onclick={() => (chosenView = 'history')}
              >
                <History class="h-3 w-3" aria-hidden="true" />
                <span>{editedLabel}</span>
              </button>
            {:else}
              <Badge data-record-edited>{editedLabel}</Badge>
            {/if}
          {/if}
        </div>
        {#if record.tags.length}
          <MetadataStrip class="mt-1">
            {#each record.tags as tag (tag)}
              <InlineLinkBadge href={resolve(ledgerUrl({ tag }))}>{tag}</InlineLinkBadge>
            {/each}
          </MetadataStrip>
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2">
      {#if dirty}
        <Badge variant="warning">Unsaved</Badge>
      {:else if editorState.saveMessage}
        <Badge variant="success">Saved</Badge>
      {/if}
    </div>
  </div>

  {#if save.isError}
    <Alert class="mt-4" variant="danger" title="Save failed">{save.error.message}</Alert>
  {:else if accept.isError || reject.isError}
    <Alert class="mt-4" variant="danger" title="Candidate action failed">
      {accept.error?.message ?? reject.error?.message}
    </Alert>
  {/if}

  {#if supersededBy.length}
    <p data-record-superseded-by class="mt-3 text-sm text-fg-muted">
      Superseded by {#each supersededBy as successor, index (successor.id)}{index ? ', ' : ''}<a
          class="text-accent hover:underline"
          href={resolve(recordHref(successor.id))}>“{successor.title}”</a
        >{/each}
    </p>
  {:else if status === 'rejected'}
    <p data-record-rejected-notice class="mt-3 text-sm text-fg-muted">
      Rejected. It stays in the archive; to revisit it, draft a new decision.
    </p>
  {/if}

  {#if lifecycle.data.diagnostics.length}
    <ul data-record-lifecycle-diagnostics class="mt-3 space-y-1 text-xs">
      {#each lifecycle.data.diagnostics as diagnostic (diagnostic.code + diagnostic.message)}
        <li>
          <span class="font-medium text-warning">{diagnostic.code}</span>
          <span class="ml-2 text-fg-muted">{diagnostic.message}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if actions.primary.length || actions.lifecycle.length || editing}
    <ActionBar data-record-actions class="mt-2 border-0 bg-transparent px-0">
      <div class="flex flex-wrap items-center gap-2">
        {#if editing}
          <Button type="button" variant="outline" size="sm" disabled={save.isPending} onclick={resetEditor}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!dirty || save.isPending} onclick={saveEditor}>
            {save.isPending ? 'Saving...' : 'Save'}
          </Button>
        {:else}
          {#each actions.primary as action (action)}
            {#if action === 'edit'}
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-record-action="edit"
                title={actions.correction ? 'Correct this record in place' : undefined}
                onclick={() => (editing = true)}
              >
                <Pencil class="h-3.5 w-3.5" aria-hidden="true" />
                <span>Edit</span>
              </Button>
            {:else if action === 'revise'}
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-record-action="revise"
                title={actions.revise === 'supersede-record' ? 'Ask the agent to draft a successor' : undefined}
                onclick={revise}
              >
                <Sparkles class="h-3.5 w-3.5" aria-hidden="true" />
                <span>Revise with agent</span>
              </Button>
            {/if}
          {/each}
        {/if}
      </div>

      {#if !editing && actions.lifecycle.length}
        <div class="ml-auto flex flex-wrap items-center gap-2">
          {#each actions.lifecycle as action (action)}
            {#if action === 'reject'}
              <Button
                type="button"
                variant="danger"
                size="sm"
                data-record-action="reject"
                disabled={reject.isPending || accept.isPending}
                onclick={() => reject.mutate()}
              >
                <X class="h-3.5 w-3.5" aria-hidden="true" />
                <span>{reject.isPending ? 'Rejecting' : 'Reject'}</span>
              </Button>
            {:else if action === 'accept'}
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-record-action="accept"
                class="border-success/40 bg-success/10 text-success hover:bg-success/20"
                disabled={accept.isPending || reject.isPending || dirty || save.isPending || stale.length > 0}
                title={stale.length ? 'Retarget the candidate at the current decision first' : undefined}
                onclick={() => accept.mutate()}
              >
                <Check class="h-3.5 w-3.5" aria-hidden="true" />
                <span>{accept.isPending ? 'Accepting' : 'Accept'}</span>
              </Button>
            {:else if action === 'supersede'}
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-record-action="supersede"
                title="Draft a successor, starting from this text"
                onclick={() => composer.show(successorDraft('supersede', id))}
              >
                <Replace class="h-3.5 w-3.5" aria-hidden="true" />
                <span>Supersede</span>
              </Button>
            {/if}
          {/each}
        </div>
      {/if}
    </ActionBar>
  {/if}

  {#if isCandidate}
    {#if surface === 'inbox'}
      <Alert
        class="mt-3"
        variant="neutral"
        title={hasMissingRationale(source.data.content) ? 'Reason for this choice is missing' : 'Review this decision'}
      >
        {#if hasMissingRationale(source.data.content)}
          The draft describes what the code does, but does not document why. Edit the decision to add or correct your reason before accepting it.
        {:else}
          Check both what was done and why. Accepting means you endorse this decision and its explanation.
        {/if}
      </Alert>
      {#if pending.length && !stale.length}
        <Alert class="mt-2" variant="neutral" title="Proposed successor">
          Accepting will supersede
          {#each pending as predecessor, index (predecessor.id)}
            {index ? ', ' : ''}<a class="text-accent underline" href={resolve(recordHref(predecessor.id))}>
              {predecessor.title}
            </a>
          {/each}{pending.length === 1 ? ', which moves' : ', which move'} to the archive unchanged.
        </Alert>
      {/if}
      {#each stale as entry (entry.predecessor.id)}
        <div class="mt-2">
          <StaleSupersedesNotice
            {id}
            stale={entry}
            source={source.data.content}
            disabled={dirty || editing}
            {recordHref}
          />
        </div>
      {/each}
    {:else}
      <Alert class="mt-3" variant="info" data-record-candidate-notice>
        This is a candidate.
        <a class="underline" href={resolve(inboxUrl(candidateItemId(id)))}>Review it in the Inbox.</a>
      </Alert>
    {/if}
  {/if}

  {#if editing}
    {#if actions.correction}
      <Alert class="mt-3" variant="neutral" data-record-correction-note>
        Corrections such as spelling, formatting, links, or citations stay in this record and show in its History
        from Git.
        {#if status === 'accepted'}
          To change the decision, use Supersede.
        {:else if status === 'superseded'}
          To change the decision, supersede the decision now in force.
        {:else}
          To revisit the decision, draft a new candidate.
        {/if}
      </Alert>
    {/if}
    <div class={embedded ? 'mt-4 flex min-h-0 flex-1 flex-col' : 'mt-4 block'}>
      <span class="mb-2 block text-sm font-medium text-fg">Raw Markdown</span>
      <MarkdownEditor
        data-record-editor-pane
        bind:value={editorState.editor}
        ariaLabel="Raw Markdown"
        onsave={saveEditor}
        autofocus
        class={embedded ? 'min-h-0 flex-1' : 'h-[28rem] resize-y'}
      />
    </div>
  {:else}
    {#if views.length}
      <SegmentedTabs
        class="mt-4"
        ariaLabel="Record view"
        data-record-views
        value={view}
        items={views}
        onselect={(next) => {
          chosenView = next;
        }}
      />
    {/if}

    {#if view === 'changes' && pending.length}
      <div data-record-changes-pane class={`mt-3 ${embedded ? 'min-h-0 flex-1 overflow-auto' : ''}`}>
        <SuccessorChanges {id} predecessors={pending} source={source.data.content} {recordHref} />
      </div>
    {:else if view === 'history'}
      <div data-record-history-pane class={`mt-3 ${embedded ? 'min-h-0 flex-1 overflow-auto' : ''}`}>
        {#if history.isPending}
          <p class="text-sm text-fg-muted">Loading the history…</p>
        {:else if history.isError}
          <Alert variant="warning" title="History unavailable">{history.error.message}</Alert>
        {:else if history.data}
          <RecordHistory history={history.data} {recordHref} />
        {/if}
      </div>
    {:else}
      <DocumentPane
        data-record-rendered-pane
        class={`rendered-markdown record-markdown mt-4 rounded-md border border-border bg-bg p-6 ${
          embedded ? 'min-h-0 flex-1 overflow-auto' : ''
        }`}
      >
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html renderedHtml}
      </DocumentPane>
    {/if}
  {/if}
{/if}

<style>
  :global(.record-markdown h1) {
    margin-bottom: 0.75rem;
    font-size: 1.5rem;
    font-weight: 650;
  }

  :global(.record-markdown h2) {
    margin-top: 1.5rem;
    margin-bottom: 0.5rem;
    font-size: 1rem;
    font-weight: 650;
  }
</style>
