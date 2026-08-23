<script lang="ts">
  import { href, isPath } from '../../lib/paths';
  import { byCategory, CATEGORY_ICONS, REGISTRY } from '../../lib/registry';
  import Icon from '../Icon.svelte';
  import CommandPalette from './CommandPalette.svelte';

  let { currentPath = '/' }: { currentPath?: string } = $props();

  // One breakpoint, shared by CSS (range syntax, no fractional-zoom gap) and
  // JS. Below it the sidebar is an off-canvas drawer; above, a persisted
  // collapse down to the rail.
  const MOBILE_MQ = '(width < 64rem)';
  const COLLAPSE_KEY = 'useful-sidebar-collapsed';

  // The island is persisted across view transitions, so track the live path
  // ourselves — astro:page-load fires after every client-side navigation.
  let path = $state(currentPath);
  let drawerOpen = $state(false);
  let paletteOpen = $state(false);
  // The element to hand focus back to when the palette closes. Captured at
  // open time (Safari never focuses clicked buttons, so document.activeElement
  // inside the palette would record <body> for click-opens).
  let paletteOpener: HTMLElement | null = $state(null);
  let isMobile = $state(false);
  // Collapse state is pre-applied to <html> before first paint (Layout.astro)
  // so the page never flashes; the component just mirrors and toggles it.
  let collapsed = $state(
    typeof document !== 'undefined' && document.documentElement.dataset.sidebar === 'collapsed'
  );

  /**
   * The sidebar is a RAIL of categories with one category's tools beside it
   * (Phase 14, sidebar variant G). The App category is not a rail entry: its
   * one tool, Settings, is the gear pinned to the foot of the rail, and the
   * home page's link is the brand in the topbar.
   */
  const groups = byCategory().filter((g) => g.category !== 'App');
  const settings = REGISTRY.find((t) => t.id === 'settings')!;

  /** The category of the page at `path`, or null for the home page / Settings. */
  function categoryOf(p: string): string | null {
    const tool = REGISTRY.find((t) => t.category !== 'App' && isPath(p, t.route));
    return tool?.category ?? null;
  }

  // Which category the flyout shows. Follows the page; a rail click overrides
  // it until the next navigation lands in a different category.
  let active = $state(categoryOf(currentPath) ?? groups[0]!.category);
  const activeGroup = $derived(groups.find((g) => g.category === active) ?? groups[0]!);
  const railIcon = (g: (typeof groups)[number]): string =>
    CATEGORY_ICONS[g.category] ?? g.tools[0]?.icon ?? 'settings';

  $effect(() => {
    const mql = window.matchMedia(MOBILE_MQ);
    isMobile = mql.matches;
    const onBreakpoint = () => {
      isMobile = mql.matches;
      // A drawer left open on mobile must not pop back open after resizing
      // to desktop and back.
      if (!mql.matches) drawerOpen = false;
    };
    const onPageLoad = () => {
      path = window.location.pathname;
      const category = categoryOf(path);
      if (category) active = category;
      drawerOpen = false;
      paletteOpen = false; // browser back/forward swaps the page underneath
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        !e.repeat &&
        e.key.toLowerCase() === 'k'
      ) {
        e.preventDefault();
        if (!paletteOpen) paletteOpener = document.activeElement as HTMLElement | null;
        paletteOpen = !paletteOpen;
      } else if (e.key === 'Escape' && drawerOpen && !paletteOpen) {
        // One Escape per layer: the palette (topmost) handles its own.
        drawerOpen = false;
      }
    };
    mql.addEventListener('change', onBreakpoint);
    document.addEventListener('astro:page-load', onPageLoad);
    window.addEventListener('keydown', onKeydown);
    return () => {
      mql.removeEventListener('change', onBreakpoint);
      document.removeEventListener('astro:page-load', onPageLoad);
      window.removeEventListener('keydown', onKeydown);
    };
  });

  // Both overlays are modal surfaces — the page behind them must not scroll.
  $effect(() => {
    const lock = drawerOpen || paletteOpen;
    document.body.style.overflow = lock ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  });

  function setCollapsed(value: boolean): void {
    collapsed = value;
    if (value) {
      document.documentElement.dataset.sidebar = 'collapsed';
      localStorage.setItem(COLLAPSE_KEY, '1');
    } else {
      delete document.documentElement.dataset.sidebar;
      localStorage.removeItem(COLLAPSE_KEY);
    }
  }

  function toggleSidebar(): void {
    if (isMobile) {
      drawerOpen = !drawerOpen;
      return;
    }
    setCollapsed(!collapsed);
  }

  /** A rail click shows that category — and, collapsed, brings the list back. */
  function pickCategory(category: string): void {
    active = category;
    if (!isMobile && collapsed) setCollapsed(false);
  }

  function openPalette(e: MouseEvent): void {
    paletteOpener = e.currentTarget as HTMLElement;
    paletteOpen = true;
  }
</script>

<header class="topbar">
  <button
    class="icon-btn"
    data-testid="sidebar-toggle"
    aria-label="Toggle navigation"
    aria-expanded={isMobile ? drawerOpen : !collapsed}
    aria-controls="app-sidebar"
    onclick={toggleSidebar}
  >
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2 5h16M2 10h16M2 15h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  </button>

  <a class="brand" href={href('/')} data-testid="nav-brand">
    <!-- Drafting compass: hinge, two legs, and the amber arc it just drew. -->
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1v2" stroke="currentColor" stroke-width="1.5" />
      <circle cx="8" cy="4.5" r="1.5" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M7.2 6 4 13M8.8 6l3.2 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
      <path d="M3 14.2q5 2.6 10 0" fill="none" stroke="var(--color-stamp)" stroke-width="1.5" />
    </svg>
    <span>useful</span>
  </a>
  <span class="sheet-code" aria-hidden="true">DWG · UF-001</span>

  <span class="spacer"></span>

  <button
    class="search-btn"
    data-testid="open-palette"
    aria-label="Search tools"
    aria-haspopup="dialog"
    onclick={openPalette}
  >
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M10 10l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
    <span>Search</span>
    <kbd aria-hidden="true">Ctrl K</kbd>
  </button>
</header>

{#if drawerOpen}
  <div class="drawer-backdrop" role="presentation" onclick={() => (drawerOpen = false)}></div>
{/if}

<aside id="app-sidebar" class="sidebar" class:open={drawerOpen} aria-label="Tools">
  <!-- The rail: one button per category, the gear for Settings at the foot. -->
  <nav class="rail" aria-label="Categories" data-testid="sidebar-rail">
    <ul>
      {#each groups as group (group.category)}
        <li>
          <button
            type="button"
            class="rail-btn"
            class:active={group.category === active}
            aria-pressed={group.category === active}
            aria-controls="sidebar-flyout"
            title={group.category}
            data-testid={'rail-' + group.category.toLowerCase()}
            onclick={() => pickCategory(group.category)}
          >
            <span class="icon"><Icon name={railIcon(group)} /></span>
            <span class="rail-label">{group.category}</span>
          </button>
        </li>
      {/each}
    </ul>
    <a
      class="rail-btn gear"
      href={href(settings.route)}
      aria-label={settings.name}
      title={settings.name}
      aria-current={isPath(path, settings.route) ? 'page' : undefined}
      data-testid={'nav-' + settings.id}
    >
      <span class="icon"><Icon name={settings.icon} /></span>
    </a>
  </nav>

  <!-- The flyout: the active category's tools. Hidden with the sidebar
       collapsed; the rail stays. -->
  <nav class="flyout" id="sidebar-flyout" aria-label={activeGroup.category} data-testid="sidebar-flyout">
    <h2>{activeGroup.category}</h2>
    <ul>
      {#each activeGroup.tools as tool (tool.id)}
        <li>
          <a
            href={href(tool.route)}
            aria-current={isPath(path, tool.route) ? 'page' : undefined}
            data-testid={'nav-' + tool.id}
          >
            <span class="icon"><Icon name={tool.icon} /></span>
            <span>{tool.name}</span>
          </a>
        </li>
      {/each}
    </ul>
  </nav>
</aside>

{#if paletteOpen}
  <CommandPalette opener={paletteOpener} onclose={() => (paletteOpen = false)} />
{/if}

<style>
  .topbar {
    /* Fixed and full-bleed: the body gets padding-left while the sidebar is
       open, and a sticky bar inside the padded body would start 15rem in,
       leaving a dead square above the sidebar. The body compensates with
       padding-top (global.css). */
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: var(--navbar-height);
    padding-inline: var(--space-4);
    background: var(--surface-color);
    border-bottom: 1.5px solid var(--border-strong-color);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 700;
    font-size: var(--font-size-base);
    text-decoration: none;
    color: var(--text-color);
    text-transform: uppercase;
    letter-spacing: var(--tracking-brand);
  }

  .brand svg {
    color: var(--text-color);
    flex: none;
  }

  .sheet-code {
    font-size: 0.64rem;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
    text-transform: uppercase;
    border-left: 1px solid var(--border-color);
    padding-left: var(--space-3);
  }

  .spacer {
    flex: 1;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-color);
  }

  .icon-btn:hover {
    background: var(--color-primary-soft);
  }

  .search-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.5rem;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-color);
    border: 1px solid var(--border-strong-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-muted-color);
    font-size: var(--font-size-sm);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .search-btn:hover {
    border-color: var(--color-primary);
    color: var(--text-color);
  }

  kbd {
    font-family: inherit;
    font-size: 0.75rem;
    border: 1px solid var(--border-strong-color);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-1);
    background: var(--surface-color);
  }

  /* ── Sidebar: rail + flyout ─────────────────────────────────────────── */

  .sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 30;
    width: var(--sidebar-width);
    display: flex;
    background: var(--surface-color);
    border-right: 1px solid var(--border-color);
  }

  .rail {
    flex: none;
    width: var(--rail-width);
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border-color);
    padding: var(--space-2) 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .rail ul {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
  }

  .rail-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 100%;
    min-height: 3rem;
    padding: var(--space-2) 0;
    background: none;
    border: none;
    border-radius: 0;
    cursor: pointer;
    color: var(--text-muted-color);
    font: inherit;
    /* Small enough that the longest name (PRODUCTIVITY, PLAYGROUNDS) fits the
       rail without an ellipsis; the icon above carries the recognition. */
    font-size: 0.5rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    text-decoration: none;
  }

  .rail-btn:hover {
    background: var(--color-primary-soft);
    color: var(--text-color);
  }

  .rail-btn.active,
  .rail-btn[aria-current='page'] {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
    box-shadow: inset 2px 0 0 var(--color-stamp);
  }

  .rail-label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-inline: 2px;
  }

  /* The gear: pinned to the foot of the rail, ruled off from the categories. */
  .gear {
    margin-top: auto;
    border-top: 1px solid var(--border-color);
  }

  .flyout {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-4) var(--space-2);
  }

  .flyout h2 {
    font-size: var(--font-size-eyebrow);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
    padding: var(--space-2) var(--space-3);
    margin: 0;
  }

  .flyout ul {
    list-style: none;
    margin: 0 0 var(--space-4);
    padding: 0;
  }

  .flyout a {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    text-decoration: none;
    color: var(--text-color);
    font-weight: 600;
    font-size: var(--font-size-sm);
  }

  .flyout a:hover {
    background: var(--color-primary-soft);
  }

  .flyout a[aria-current='page'] {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
    box-shadow: inset 2px 0 0 var(--color-stamp);
  }

  .sidebar .icon {
    flex: none;
    display: inline-flex;
  }

  .drawer-backdrop {
    display: none;
  }

  /* Desktop: the sidebar starts below the topbar. Collapsed (the <html>
     attribute set before first paint — no flash, survives navigation) it is
     the rail alone: a category click brings the list back. */
  @media (width >= 64rem) {
    .sidebar {
      top: var(--navbar-height);
      z-index: 5;
    }

    :global(html[data-sidebar='collapsed']) .sidebar {
      width: var(--rail-width);
    }

    :global(html[data-sidebar='collapsed']) .flyout {
      display: none;
    }
  }

  /* Mobile: off-canvas drawer over a backdrop. `visibility` rides along with
     the transform so the closed drawer's links leave the tab order and the
     accessibility tree — translateX alone hides only visually. */
  @media (width < 64rem) {
    .sidebar {
      transform: translateX(-100%);
      visibility: hidden;
      transition: transform 0.2s ease, visibility 0.2s;
      box-shadow: var(--shadow-2);
    }

    .sidebar.open {
      transform: translateX(0);
      visibility: visible;
    }

    .drawer-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 25;
      background: var(--scrim-color);
    }

    kbd {
      display: none;
    }

    .search-btn span,
    .sheet-code {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sidebar {
      transition: none;
    }
  }
</style>
