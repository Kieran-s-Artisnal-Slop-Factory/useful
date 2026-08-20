<script lang="ts">
  /**
   * A data table driven by a plain JSON description of the data's shape:
   *
   *   <DataTable
   *     schema={{ name: 'str', age: 'int', phone: 'tel', email: 'email', premium: 'boolean' }}
   *     rows={people}
   *   />
   *
   * The schema is the only configuration. From each column's type the table
   * derives its heading, its alignment, how the value is formatted, how two
   * values sort, and which filter operators it offers — so `age` gets
   * `> ≥ < ≤ = ≠ between`, `email` gets `contains / starts with / ends with`
   * and a mailto link, `premium` gets `is true / is false` and a Yes/No pill.
   *
   * Filtering is a tree of AND/OR groups (`lib/table/filter.ts`), so
   * `A AND (B OR C)` is expressible, not just a flat list. The tree is plain
   * JSON: bind it, save it, put it in a URL, or hand it to a server.
   *
   * By default everything is client-side over the `rows` you pass. Pass
   * `manual` and it inverts: the table renders `rows` as given, takes its page
   * count from `totalRows`, and reports every change through `onQueryChange`
   * for a database to answer — which is how the SQL viewer pages tables far
   * too big to send. `lib/table/to-sql.ts` turns the reported filter tree into
   * a parameterized `WHERE` clause.
   */
  import FilterBuilder from './table/FilterBuilder.svelte';
  import { downloadText } from '../lib/exportFile';
  import { csvFilename, toCsv, UTF8_BOM } from '../lib/table/csv';
  import {
    countActive,
    describeFilter,
    emptyGroup,
    filterRows,
    searchRows,
    type FilterGroup,
  } from '../lib/table/filter';
  import {
    compareValues,
    formatValue,
    isBlank,
    safeHref,
    telHref,
    toBool,
    toText,
  } from '../lib/table/format';
  import {
    columnMap,
    normalizeSchema,
    type DataRow,
    type TableQuery,
    type TableSchema,
  } from '../lib/table/types';

  let {
    schema,
    testid,
    rows = [],
    filter = $bindable(emptyGroup('and')),
    pageSize = $bindable(10),
    pageSizes = [10, 25, 50, 100],
    searchable = true,
    filterable = true,
    filtersOpen = $bindable(false),
    hiddenColumns = $bindable(undefined),
    columnMenu = true,
    exportable = true,
    exportFilename = 'table',
    virtual = false,
    rowHeight = 41,
    viewportHeight = '28rem',
    manual = false,
    pagination = 'offset',
    hasMore = false,
    totalRows = undefined,
    onQueryChange = undefined,
    busy = false,
    caption = undefined,
    empty = 'No data yet.',
    noMatches = 'No rows match these filters.',
    locale = undefined,
    dense = false,
    rowKey = undefined,
    onRowClick = undefined,
    onFilterChange = undefined,
  }: {
    /** `{ column: type }`, or `{ column: { type, label, options, … } }`. */
    schema: TableSchema;
    /**
     * Test-id prefix, and the id on the `<table>` itself. Required, with no
     * default: two grids share this page, so an id has to name which one.
     */
    testid: string;
    rows?: DataRow[];
    /** The filter tree. Bindable — read it out to persist or send upstream. */
    filter?: FilterGroup;
    pageSize?: number;
    /** Page sizes offered; 0 means "All". */
    pageSizes?: number[];
    searchable?: boolean;
    filterable?: boolean;
    filtersOpen?: boolean;
    /**
     * Columns to hide, by key. Bindable. Leave unset to start from the
     * schema's own `hidden` flags; setting it takes over from them.
     */
    hiddenColumns?: string[];
    /** Show the Columns menu for toggling visibility. */
    columnMenu?: boolean;
    /** Show the CSV export button. */
    exportable?: boolean;
    /** Stem for the downloaded file — slugified, `.csv` appended. */
    exportFilename?: string;
    /**
     * Render only the rows in view, inside a fixed-height scroller. For very
     * long lists — pair it with `pageSize={0}` to scroll the whole set.
     */
    virtual?: boolean;
    /** Row height in px. Virtual mode needs this to be accurate. */
    rowHeight?: number;
    /** Height of the virtual scroller. */
    viewportHeight?: string;
    /**
     * Someone upstream is doing the filtering, sorting and paging — a
     * database, usually. `rows` is rendered as-is, `totalRows` drives the
     * pager, and every change to the query is reported through
     * `onQueryChange` for the owner to act on.
     */
    manual?: boolean;
    /**
     * How the pager works in `manual` mode.
     *
     * `offset` numbers the pages and needs `totalRows`. `cursor` steps forward
     * and back from the last row seen, which is what stays fast deep into a
     * large table — `LIMIT/OFFSET` makes the engine walk and discard every
     * skipped row — at the cost of not being able to jump to page 500.
     */
    pagination?: 'offset' | 'cursor';
    /** Cursor mode: whether a further page exists in the stepping direction. */
    hasMore?: boolean;
    /** Total matching rows, for the pager. Required when `manual` + `offset`. */
    totalRows?: number;
    onQueryChange?: (query: TableQuery) => void;
    /** Show that a manual fetch is in flight. */
    busy?: boolean;
    caption?: string;
    empty?: string;
    noMatches?: string;
    /** BCP 47 tag for number and date formatting. Defaults to the browser's. */
    locale?: string;
    dense?: boolean;
    /** Stable key per row; defaults to the index. */
    rowKey?: (row: DataRow, index: number) => string | number;
    onRowClick?: (row: DataRow, index: number) => void;
    onFilterChange?: (filter: FilterGroup) => void;
  } = $props();

  /** Only linkify something that actually looks like an address. */
  const isEmailish = (value: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toText(value).trim());

  const columns = $derived(normalizeSchema(schema));
  const lookup = $derived(columnMap(columns));
  // The schema's `hidden` flags are the starting point; once the reader
  // touches the Columns menu, their choice takes over completely.
  const hiddenSet = $derived(
    new Set(hiddenColumns ?? columns.filter((column) => column.hidden).map((column) => column.key))
  );
  const visible = $derived(columns.filter((column) => !hiddenSet.has(column.key)));

  let search = $state('');
  let sort = $state<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  let page = $state(1);
  let columnsOpen = $state(false);
  let scrollTop = $state(0);

  // In manual mode `rows` is already the answer — filtered, sorted and sliced
  // by whoever owns the data — so every local stage is a pass-through.
  const searched = $derived(manual || !searchable ? rows : searchRows(rows, search, columns));
  const matched = $derived(manual || !filterable ? searched : filterRows(searched, filter, lookup));

  const ordered = $derived.by(() => {
    if (manual || !sort) return matched;
    const key = sort.key;
    const column = lookup.get(key);
    if (!column) return matched;
    const sign = sort.direction === 'asc' ? 1 : -1;
    // Copy first: Array.sort mutates, and `matched` may be `rows` itself.
    return [...matched].sort((a, b) => {
      // `compareValues` already sorts blanks last, but negating its result for
      // a descending sort would drag them to the front — disagreeing with the
      // `NULLS LAST` that `toSqlOrderBy` emits in BOTH directions. Since this
      // page reads the same table client-side and in SQL, the two have to
      // give the same order, so the blank rule is applied outside the sign.
      const aBlank = isBlank(a[key]);
      const bBlank = isBlank(b[key]);
      if (aBlank !== bBlank) return aBlank ? 1 : -1;
      return sign * compareValues(column, a[key], b[key]);
    });
  });

  /** Rows matching the query, which is more than are on screen when manual. */
  const total = $derived(manual ? (totalRows ?? rows.length) : ordered.length);
  const pageCount = $derived(pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1);
  // Clamped rather than corrected: filtering down to fewer pages while you're
  // on page 9 should show the last page, not an empty one.
  const currentPage = $derived(Math.min(Math.max(1, page), pageCount));
  const start = $derived(pageSize > 0 ? (currentPage - 1) * pageSize : 0);
  const paged = $derived(
    manual || pageSize <= 0 ? ordered : ordered.slice(start, start + pageSize)
  );

  const cursorMode = $derived(manual && pagination === 'cursor');

  /**
   * Cursor mode: the row each visited page starts after. `anchors[0]` is null
   * — page 1 seeks from nothing — and `anchors[n - 1]` is the last row of page
   * n - 1, which is the row page n was fetched with.
   *
   * Keeping the whole trail rather than a step count is what makes going back
   * cheap: any page already seen is one seek away, however far back it is, so
   * the pager can offer its number instead of only a Prev button. The trail
   * describes one query, so anything that changes the query starts it over.
   */
  let anchors = $state<(DataRow | null)[]>([null]);
  /** Which page of the trail is on screen. */
  let cursorPage = $state(1);

  /** Ask for a page of the trail, seeking from the row it starts after. */
  function seekTo(target: number) {
    cursorPage = target;
    onQueryChange?.({
      search,
      filter,
      sort,
      page: target,
      pageSize,
      // Every page is reached by seeking forwards from its own anchor, page 1
      // included — with the trail there is never anything to walk back over.
      step: target === 1 ? 'first' : 'next',
      cursor: anchors[target - 1] ?? null,
    });
  }

  /**
   * Tell the owner what to fetch. Called from the handlers rather than an
   * effect on purpose: an effect would also fire when the owner sets
   * `totalRows` in response, and each fetch would trigger the next.
   */
  function emitQuery(step: 'first' | 'next' | 'prev' = 'first') {
    if (!manual) return;
    if (!cursorMode) {
      onQueryChange?.({ search, filter, sort, page: Math.max(1, page), pageSize });
      return;
    }
    if (step === 'next') {
      // The next page starts after this one's last row. Anything further along
      // the trail was reached from a page we have since left, so it goes.
      const anchor = rows.at(-1);
      // No last row means the previous fetch failed or came back empty. Seeking
      // from null is the page-one query, so advancing would silently re-serve
      // page one while the pager believed it had moved.
      if (!anchor) return;
      anchors = [...anchors.slice(0, cursorPage), anchor];
      seekTo(cursorPage + 1);
      return;
    }
    if (step === 'prev') {
      goToCursorPage(cursorPage - 1);
      return;
    }
    // A new query: the old trail led through rows that are no longer the set
    // being paged.
    anchors = [null];
    seekTo(1);
  }

  /** Jump to any page already visited — one seek, however many pages back. */
  function goToCursorPage(target: number) {
    const clamped = Math.min(Math.max(1, target), anchors.length);
    if (clamped !== cursorPage) seekTo(clamped);
  }

  /**
   * Virtual mode: the slice of `paged` actually in view, plus the spacer
   * heights that keep the scrollbar honest. `overscan` rows are rendered
   * beyond each edge so a fast scroll doesn't show blank rows.
   */
  const overscan = 6;
  const window_ = $derived.by(() => {
    if (!virtual) return { rows: paged, before: 0, after: 0, offset: 0 };
    // The viewport height is a CSS length, so ask the element; before it
    // exists, guess generously rather than rendering a single row.
    const height = viewportPx || 600;
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const count = Math.ceil(height / rowHeight) + overscan * 2;
    const last = Math.min(paged.length, first + count);
    return {
      rows: paged.slice(first, last),
      before: first * rowHeight,
      after: Math.max(0, (paged.length - last) * rowHeight),
      offset: first,
    };
  });

  let viewportPx = $state(0);

  const activeCount = $derived(countActive(filter, lookup));
  const summary = $derived(describeFilter(filter, lookup));

  function toggleColumn(key: string) {
    const next = new Set(hiddenSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Never hide the last column — an empty table is unrecoverable from the
    // menu, because there'd be no header left to click.
    if (next.size >= columns.length) return;
    hiddenColumns = [...next];
  }

  const showAllColumns = () => (hiddenColumns = []);

  /**
   * Export every row the filters left, in the current sort order and with the
   * visible columns — not just the page on screen, which is almost never what
   * someone means by "export".
   */
  function exportCsv() {
    const csv = toCsv(ordered, visible, { locale });
    // The BOM is what makes Excel read the file as UTF-8 rather than as the
    // system codepage, which would mangle every accent and currency symbol.
    downloadText(UTF8_BOM + csv, csvFilename(exportFilename), 'text/csv;charset=utf-8');
  }

  /** Page numbers with gaps, e.g. 1 … 4 5 6 … 20. */
  function elidePages(count: number, current: number): (number | 'gap')[] {
    if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
    const around = new Set([1, count, current, current - 1, current + 1]);
    const kept = [...around].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);
    const out: (number | 'gap')[] = [];
    let previous = 0;
    for (const n of kept) {
      if (previous && n - previous > 1) out.push('gap');
      out.push(n);
      previous = n;
    }
    return out;
  }

  const pageList = $derived(elidePages(pageCount, currentPage));
  /**
   * Cursor mode: the pages the trail can reach, which is the ones already
   * visited — each kept the row it starts after. What cursor paging still
   * can't offer is a number for a page nobody has been to.
   */
  const cursorPageList = $derived(elidePages(anchors.length, cursorPage));

  function toggleSort(key: string) {
    // asc → desc → unsorted, so a stray click is always one more click away
    // from the original order.
    if (sort?.key !== key) sort = { key, direction: 'asc' };
    else if (sort.direction === 'asc') sort = { key, direction: 'desc' };
    else sort = null;
    emitQuery('first');
  }

  function applyFilter(next: FilterGroup) {
    filter = next;
    page = 1;
    onFilterChange?.(next);
    emitQuery('first');
  }

  function goToPage(next: number) {
    page = next;
    emitQuery();
  }

  function clearFilters() {
    applyFilter(emptyGroup('and'));
  }

  const ariaSort = (key: string) =>
    sort?.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';

  const rangeLabel = $derived.by(() => {
    // Cursor mode has no total — that's the point; counting every match would
    // cost exactly the full scan the mode exists to avoid.
    if (cursorMode) {
      if (rows.length === 0) return '0 rows';
      return `${rows.length.toLocaleString(locale)} rows · page ${cursorPage.toLocaleString(locale)}`;
    }
    if (total === 0) return '0 rows';
    const from = start + 1;
    const to = Math.min(start + paged.length, total);
    const of = total.toLocaleString(locale);
    // Only meaningful client-side: in manual mode the unfiltered count is
    // upstream and nobody here knows it.
    const hidden = manual ? 0 : rows.length - ordered.length;
    const suffix = hidden > 0 ? ` (${hidden.toLocaleString(locale)} filtered out)` : '';
    return `${from.toLocaleString(locale)}–${to.toLocaleString(locale)} of ${of}${suffix}`;
  });
</script>

<div class="dt" class:dense>
  {#if searchable || filterable}
    <div class="row toolbar">
      {#if searchable}
        <label class="search">
          <span class="visually-hidden">Search all columns</span>
          <input
            data-testid={testid + '-search'}
            type="search"
            placeholder="Search…"
            value={search}
            oninput={(e) => {
              search = e.currentTarget.value;
              page = 1;
              emitQuery('first');
            }}
          />
        </label>
      {/if}

      {#if filterable}
        <button
          type="button"
          class="btn btn-sm"
          data-testid={testid + '-filters'}
          aria-expanded={filtersOpen}
          onclick={() => (filtersOpen = !filtersOpen)}
        >
          Filters
          {#if activeCount > 0}<span class="badge count">{activeCount}</span>{/if}
        </button>
        {#if activeCount > 0}
          <button
            type="button"
            class="btn btn-sm btn-danger"
            data-testid={testid + '-filters-clear'}
            onclick={clearFilters}>Clear</button
          >
        {/if}
        {#if summary && !filtersOpen}
          <span class="muted summary" data-testid={testid + '-summary'} title={summary}>{summary}</span>
        {/if}
      {/if}

      {#if columnMenu}
        <div class="menu-wrap">
          <button
            type="button"
            class="btn btn-sm"
            data-testid={testid + '-columns'}
            aria-expanded={columnsOpen}
            onclick={() => (columnsOpen = !columnsOpen)}
          >
            Columns
            {#if hiddenSet.size > 0}<span class="badge count">{visible.length}/{columns.length}</span
              >{/if}
          </button>
          {#if columnsOpen}
            <!-- Closes on click-away or Escape, like any menu. -->
            <div
              class="menu"
              role="group"
              data-testid={testid + '-columns-menu'}
              aria-label="Toggle columns"
              onmouseleave={() => (columnsOpen = false)}
            >
              {#each columns as column (column.key)}
                <!-- A column the schema hides is dimmed and labelled, so it
                     reads as "off by design" rather than "you turned this
                     off" — but it can still be switched on, and it filters
                     and sorts either way. -->
                <label
                  class="check menu-item"
                  class:by-schema={column.hidden}
                  title={column.hidden
                    ? `${column.label} is hidden by the schema — it still filters and sorts`
                    : undefined}
                >
                  <input
                    data-testid={testid + '-column-' + column.key}
                    type="checkbox"
                    checked={!hiddenSet.has(column.key)}
                    onchange={() => toggleColumn(column.key)}
                  />
                  <span>{column.label}</span>
                  {#if column.hidden}<span class="menu-tag">schema</span>{/if}
                </label>
              {/each}
              <button
                type="button"
                class="btn btn-sm menu-all"
                data-testid={testid + '-columns-all'}
                onclick={showAllColumns}
              >
                Show all
              </button>
            </div>
          {/if}
        </div>
      {/if}

      {#if exportable}
        <button
          type="button"
          class="btn btn-sm"
          data-testid={testid + '-export'}
          onclick={exportCsv}
          disabled={ordered.length === 0}
          title={manual
            ? 'Download the rows on this page as CSV'
            : 'Download every filtered row as CSV'}>Export CSV</button
        >
      {/if}

      <span class="muted count-label" data-testid={testid + '-range'}>
        {#if busy}<span class="spinner" data-testid={testid + '-busy'} aria-hidden="true"></span>{/if}
        {rangeLabel}
      </span>
    </div>
  {/if}

  {#if filterable && filtersOpen}
    <div class="builder">
      <FilterBuilder
        node={filter}
        {columns}
        testid={testid + '-builder'}
        onChange={applyFilter}
      />
    </div>
  {/if}

  <div
    class="table-wrap"
    class:virtual
    style={virtual ? `height: ${viewportHeight}` : undefined}
    onscroll={virtual ? (e) => (scrollTop = e.currentTarget.scrollTop) : undefined}
    bind:clientHeight={viewportPx}
  >
    <table class="data-table" data-testid={testid}>
      {#if caption}<caption>{caption}</caption>{/if}
      <thead>
        <tr>
          {#each visible as column (column.key)}
            <th
              scope="col"
              style={column.width ? `width: ${column.width}` : undefined}
              class:align-right={column.align === 'right'}
              class:align-center={column.align === 'center'}
              aria-sort={ariaSort(column.key)}
            >
              {#if column.sortable}
                <button
                  type="button"
                  class="sort"
                  data-testid={testid + '-sort-' + column.key}
                  onclick={() => toggleSort(column.key)}
                >
                  <span>{column.label}</span>
                  <span class="arrow" aria-hidden="true">
                    {sort?.key === column.key ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
                  </span>
                </button>
              {:else}
                {column.label}
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if window_.before > 0}
          <!-- Spacers stand in for the rows above and below the window, so
               the scrollbar reflects the whole list rather than the slice. -->
          <tr class="row-spacer" style={`height: ${window_.before}px`} aria-hidden="true"></tr>
        {/if}
        {#each window_.rows as row, i (rowKey ? rowKey(row, start + window_.offset + i) : start + window_.offset + i)}
          {@const index = window_.offset + i}
          <tr
            class:clickable={!!onRowClick}
            style={virtual ? `height: ${rowHeight}px` : undefined}
            onclick={onRowClick ? () => onRowClick(row, start + index) : undefined}
          >
            {#each visible as column (column.key)}
              {@const value = row[column.key]}
              <td
                class:align-right={column.align === 'right'}
                class:align-center={column.align === 'center'}
              >
                {#if isBlank(value) && value !== false && value !== 0}
                  <span class="blank" aria-label="empty">—</span>
                {:else if column.type === 'bool'}
                  {@const flag = toBool(value)}
                  <span class="pill" class:yes={flag === true} class:no={flag === false}>
                    {flag === null ? toText(value) : flag ? '✓ Yes' : '✗ No'}
                  </span>
                {:else if column.type === 'enum'}
                  <span class="pill">{toText(value)}</span>
                {:else if column.type === 'email' && isEmailish(value)}
                  <a href={`mailto:${toText(value).trim()}`}>{toText(value)}</a>
                {:else if column.type === 'tel'}
                  {@const href = telHref(value)}
                  {#if href}<a {href}>{toText(value)}</a>{:else}{toText(value)}{/if}
                {:else if column.type === 'url'}
                  {@const href = safeHref(value)}
                  {#if href}
                    <a {href} target="_blank" rel="noopener noreferrer nofollow"
                      >{formatValue(column, value, row, locale)}</a
                    >
                  {:else}
                    {toText(value)}
                  {/if}
                {:else if column.type === 'json' || column.type === 'uuid'}
                  <code class="mono">{formatValue(column, value, row, locale)}</code>
                {:else}
                  {formatValue(column, value, row, locale)}
                {/if}
              </td>
            {/each}
          </tr>
        {:else}
          <tr>
            <td class="empty-cell" data-testid={testid + '-empty'} colspan={visible.length}>
              {rows.length === 0 ? empty : noMatches}
            </td>
          </tr>
        {/each}
        {#if window_.after > 0}
          <tr class="row-spacer" style={`height: ${window_.after}px`} aria-hidden="true"></tr>
        {/if}
      </tbody>
    </table>
  </div>

  {#if cursorMode || pageCount > 1 || pageSizes.length > 1}
    <div class="row pager">
      {#if pageSizes.length > 1}
        <label class="per-page">
          <span class="visually-hidden">Rows per page</span>
          <select
            data-testid={testid + '-page-size'}
            value={pageSize}
            onchange={(e) => {
              pageSize = Number(e.currentTarget.value);
              page = 1;
              emitQuery('first');
            }}
            aria-label="Rows per page"
          >
            {#each pageSizes.filter((size) => size > 0 || !cursorMode) as size (size)}
              <option value={size}>{size === 0 ? 'All' : `${size} / page`}</option>
            {/each}
          </select>
        </label>
      {/if}

      <div class="flex-spacer"></div>

      {#if cursorMode}
        <!-- Numbered as far as the trail goes: every page visited kept the row
             it starts after, so going back to any of them is a single seek.
             Forwards there is only Next — without a total, nobody here knows
             how many pages are left. -->
        <nav class="pages" aria-label="Pagination">
          <button
            type="button"
            class="btn btn-sm"
            data-testid={testid + '-prev'}
            onclick={() => emitQuery('prev')}
            disabled={cursorPage <= 1 || busy}
            aria-label="Previous page">‹ Prev</button
          >
          {#each cursorPageList as entry, i (typeof entry === 'number' ? entry : `gap${i}`)}
            {#if entry === 'gap'}
              <span class="gap" aria-hidden="true">…</span>
            {:else}
              <button
                type="button"
                class="btn btn-sm page-btn"
                class:on={entry === cursorPage}
                data-testid={testid + '-page-' + entry}
                aria-current={entry === cursorPage ? 'page' : undefined}
                aria-label={`Page ${entry}`}
                disabled={busy}
                onclick={() => goToCursorPage(entry)}>{entry}</button
              >
            {/if}
          {/each}
          <button
            type="button"
            class="btn btn-sm"
            data-testid={testid + '-next'}
            onclick={() => emitQuery('next')}
            disabled={!hasMore || busy}
            aria-label="Next page">Next ›</button
          >
        </nav>
      {:else if pageCount > 1}
        <nav class="pages" aria-label="Pagination">
          <button
            type="button"
            class="btn btn-sm"
            data-testid={testid + '-prev'}
            onclick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Previous page">‹</button
          >
          {#each pageList as entry, i (typeof entry === 'number' ? entry : `gap${i}`)}
            {#if entry === 'gap'}
              <span class="gap" aria-hidden="true">…</span>
            {:else}
              <button
                type="button"
                class="btn btn-sm page-btn"
                class:on={entry === currentPage}
                data-testid={testid + '-page-' + entry}
                aria-current={entry === currentPage ? 'page' : undefined}
                aria-label={`Page ${entry}`}
                onclick={() => goToPage(entry)}>{entry}</button
              >
            {/if}
          {/each}
          <button
            type="button"
            class="btn btn-sm"
            data-testid={testid + '-next'}
            onclick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= pageCount}
            aria-label="Next page">›</button
          >
        </nav>
      {/if}
    </div>
  {/if}
</div>

<style>
  .dt {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .toolbar {
    gap: var(--space-2);
  }

  .search input {
    width: auto;
    min-width: 14rem;
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-sm);
  }

  .search {
    margin: 0;
  }

  .count-label {
    margin-left: auto;
    font-size: var(--font-size-sm);
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* A quiet "fetching" hint for manual mode — the row count is about to
     change, and nothing else on the page would say so. */
  .spinner {
    width: 0.7em;
    height: 0.7em;
    border: 2px solid var(--border-color);
    border-top-color: var(--color-primary);
    border-radius: var(--radius-full);
    animation: dt-spin 0.7s linear infinite;
  }

  @keyframes dt-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 3s;
    }
  }

  .summary {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 32ch;
  }

  .count {
    padding: 0 var(--space-1);
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
    border-color: var(--color-primary);
  }

  .menu-wrap {
    position: relative;
  }

  .menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    z-index: 20;
    min-width: 12rem;
    max-height: 18rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--surface-color);
    box-shadow: var(--shadow-2);
  }

  .menu-item {
    font-size: var(--font-size-sm);
    white-space: nowrap;
    gap: var(--space-2);
  }

  .menu-item.by-schema > span:first-of-type {
    color: var(--text-muted-color);
  }

  .menu-tag {
    margin-left: auto;
    padding: 0 var(--space-1);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--surface-raised-color);
    color: var(--text-muted-color);
    font-size: 0.85em;
  }

  .menu-all {
    margin-top: var(--space-1);
  }

  /* Virtual mode: a fixed-height scroller with the header pinned, so the
     column names stay put while thousands of rows go past. */
  .table-wrap.virtual {
    overflow-y: auto;
    position: relative;
  }

  .table-wrap.virtual :global(thead th) {
    position: sticky;
    top: 0;
    z-index: 2;
  }

  /* Spacers only reserve height; they must never look like a row. */
  .row-spacer {
    background: none;
    border: none;
  }

  .row-spacer:hover {
    background: none;
  }

  /* Sorting headers are buttons so they're keyboard-reachable; the cell keeps
     its own alignment, and the button just fills it. */
  .sort {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    cursor: pointer;
  }

  .sort:hover {
    color: var(--color-primary-strong);
  }

  .arrow {
    font-size: 0.75em;
    opacity: 0.5;
  }

  .sort:hover .arrow {
    opacity: 1;
  }

  th[aria-sort='ascending'] .arrow,
  th[aria-sort='descending'] .arrow {
    opacity: 1;
    color: var(--color-primary-strong);
  }

  .align-right {
    text-align: right;
  }

  .align-center {
    text-align: center;
  }

  /* Numbers line up only if their digits do. */
  td.align-right {
    font-variant-numeric: tabular-nums;
  }

  tbody tr.clickable {
    cursor: pointer;
  }

  tbody tr:hover {
    background: var(--surface-raised-color);
  }

  .blank {
    color: var(--text-muted-color);
    opacity: 0.6;
  }

  .pill {
    display: inline-block;
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-color);
    background: var(--surface-raised-color);
    font-size: var(--font-size-sm);
    font-weight: 600;
    white-space: nowrap;
  }

  .pill.yes {
    color: var(--color-success);
    border-color: var(--color-success);
    /* No `-soft` token here, and one pill does not earn a fourth colour
       concept. Mixing two light-dark() tokens works in both themes. */
    background: color-mix(in srgb, var(--color-success) 18%, var(--surface-color));
  }

  .pill.no {
    color: var(--text-muted-color);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: none;
    padding: 0;
  }

  .empty-cell {
    text-align: center;
    color: var(--text-muted-color);
    padding: var(--space-5) var(--space-3);
  }

  caption {
    caption-side: top;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
  }

  .dense :global(.data-table th),
  .dense :global(.data-table td) {
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-sm);
  }

  .pager {
    gap: var(--space-2);
  }

  .flex-spacer {
    flex: 1;
  }

  .per-page {
    margin: 0;
  }

  .per-page select {
    width: auto;
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-sm);
  }

  .pages {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  .page-btn.on {
    background: var(--color-primary-soft);
    border-color: var(--color-primary);
    color: var(--color-primary-strong);
  }

  .gap {
    color: var(--text-muted-color);
    padding: 0 var(--space-1);
  }

  .muted {
    color: var(--text-muted-color);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  /* `.badge` and `.check` are global in the donor. This app's pattern is to
     re-declare a two-rule helper where it is used rather than grow the shared
     stylesheet, which is what SchedulerApp and SqlPlaygroundApp already do
     with `.small`, `.banner` and `.seg`. */
  .badge {
    display: inline-block;
    margin-left: var(--space-1);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-weight: 700;
    line-height: 1.4;
  }

  .check {
    display: flex;
    align-items: center;
    margin: 0;
    cursor: pointer;
  }

  .check input {
    width: auto;
    margin: 0;
  }
</style>
