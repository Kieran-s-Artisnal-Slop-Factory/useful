<script lang="ts">
  import { ICONS } from '../lib/icons';

  // Stroke icon in the drafting linework color (currentColor). `name` is a
  // key of ICONS (src/lib/icons.ts) — unknown names render an empty box
  // rather than throwing, so a registry typo degrades visibly, not fatally.
  let { name, size = 16 }: { name: string; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <!-- Static app-internal markup from src/lib/icons.ts, never user input. -->
  {@html ICONS[name] ?? '<rect x="4" y="4" width="16" height="16"/>'}
</svg>
