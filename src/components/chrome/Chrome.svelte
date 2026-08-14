<script lang="ts">
  import { href, isPath } from '../../lib/paths';
  import { byCategory } from '../../lib/registry';
  import CommandPalette from './CommandPalette.svelte';

  let { currentPath = '/' }: { currentPath?: string } = $props();

  // One breakpoint, shared by CSS (range syntax, no fractional-zoom gap) and
  // JS. Below it the sidebar is an off-canvas drawer; above, a persisted
  // collapse.
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

  const groups = byCategory();

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

  function toggleSidebar(): void {
    if (isMobile) {
      drawerOpen = !drawerOpen;
      return;
    }
    collapsed = !collapsed;
    if (collapsed) {
      document.documentElement.dataset.sidebar = 'collapsed';
      localStorage.setItem(COLLAPSE_KEY, '1');
    } else {
      delete document.documentElement.dataset.sidebar;
      localStorage.removeItem(COLLAPSE_KEY);
    }
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

  <a class="brand" href={href('/')}>useful</a>

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
  <nav>
    {#each groups as group (group.category)}
      <section>
        <h2>{group.category}</h2>
        <ul>
          {#each group.tools as tool (tool.id)}
            <li>
              <a
                href={href(tool.route)}
                aria-current={isPath(path, tool.route) ? 'page' : undefined}
                data-testid={'nav-' + tool.id}
              >
                <span class="icon" aria-hidden="true">{tool.icon}</span>
                <span>{tool.name}</span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </nav>
</aside>

{#if paletteOpen}
  <CommandPalette opener={paletteOpener} onclose={() => (paletteOpen = false)} />
{/if}

<style>
  .topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: var(--navbar-height);
    padding-inline: var(--space-4);
    background: var(--surface-color);
    border-bottom: 1px solid var(--border-color);
  }

  .brand {
    font-weight: 800;
    font-size: var(--font-size-lg);
    text-decoration: none;
    color: var(--color-primary);
    letter-spacing: -0.02em;
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
    border-radius: var(--radius-full);
    cursor: pointer;
    color: var(--text-muted-color);
    font-size: var(--font-size-sm);
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

  .sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 30;
    width: var(--sidebar-width);
    background: var(--surface-color);
    border-right: 1px solid var(--border-color);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-4) var(--space-3);
  }

  .sidebar h2 {
    font-size: var(--font-size-sm);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted-color);
    padding: var(--space-2) var(--space-3);
  }

  .sidebar ul {
    list-style: none;
    margin: 0 0 var(--space-4);
    padding: 0;
  }

  .sidebar a {
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

  .sidebar a:hover {
    background: var(--color-primary-soft);
  }

  .sidebar a[aria-current='page'] {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
  }

  .sidebar .icon {
    flex: none;
  }

  .drawer-backdrop {
    display: none;
  }

  /* Desktop: the sidebar starts below the topbar and collapses via the <html>
     attribute set before first paint (no flash, survives navigation). */
  @media (width >= 64rem) {
    .sidebar {
      top: var(--navbar-height);
      z-index: 5;
    }

    :global(html[data-sidebar='collapsed']) .sidebar {
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
      background: rgb(0 0 0 / 0.4);
    }

    kbd {
      display: none;
    }

    .search-btn span {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sidebar {
      transition: none;
    }
  }
</style>
