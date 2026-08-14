<script lang="ts">
  import { href } from '../../lib/paths';
  import { byCategory } from '../../lib/registry';

  // Everything except Home itself — the home screen is the registry, rendered.
  const groups = byCategory()
    .map((g) => ({ ...g, tools: g.tools.filter((t) => t.id !== 'home') }))
    .filter((g) => g.tools.length > 0);
</script>

<div class="page-header">
  <h1>useful</h1>
</div>

{#each groups as group (group.category)}
  <section class="group">
    <h2>{group.category}</h2>
    <div class="tiles">
      {#each group.tools as tool (tool.id)}
        <a class="tile" href={href(tool.route)} data-testid={'tile-' + tool.id}>
          <span class="icon" aria-hidden="true">{tool.icon}</span>
          <span class="name">{tool.name}</span>
          <span class="desc">{tool.description}</span>
        </a>
      {/each}
    </div>
  </section>
{/each}

<p class="muted status">
  Everything lives in this browser — remember to export a backup now and then in
  <a href={href('/settings/')}>Settings</a>.
</p>

<style>
  .group {
    margin-bottom: var(--space-5);
  }

  .group h2 {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--color-stamp);
    margin-bottom: var(--space-3);
  }

  .tiles {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    background: var(--surface-color);
    border: 1px solid var(--border-strong-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-1);
    text-decoration: none;
    color: var(--text-color);
  }

  .tile:hover {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px var(--color-primary-soft);
  }

  .icon {
    font-size: var(--font-size-xl);
  }

  .name {
    font-weight: 700;
  }

  .desc {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
  }

  .status {
    margin-top: var(--space-5);
    font-size: var(--font-size-sm);
  }
</style>
