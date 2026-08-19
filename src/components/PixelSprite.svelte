<script lang="ts">
  /**
   * Renders one pixel grid as crisp SVG rects — one `<rect>` per painted
   * pixel with `shape-rendering: crispEdges`. Worst case is a few hundred
   * rects (a 24×24 grid), so there's no need to merge runs.
   *
   * Generalized from workoutt's pet renderer: instead of a fixed palette it
   * takes a `colors` legend (any character → any CSS colour), so it draws
   * anything the editor can make, not just pets.
   *
   * `animation` plays one of the pure-CSS presets from lib/sprite/animations.
   * Motion is pixel-aligned via `--pet-px` (grid pixel → display pixels) and
   * squashes from the feet; everything stops under reduced-motion.
   */
  import { spritePixels, type ColorMap, type Sprite } from '../lib/sprite/types';
  import type { SpriteAnimation } from '../lib/sprite/animations';

  let {
    grid,
    colors,
    size = 96,
    title = '',
    animation = 'none',
    class: className = '',
  }: {
    grid: Sprite;
    colors: ColorMap;
    /** Rendered CSS size in px; the viewBox scales the grid up to it. */
    size?: number;
    title?: string;
    animation?: SpriteAnimation;
    class?: string;
  } = $props();

  const pixels = $derived(spritePixels(grid, colors));
  // One grid pixel in display px — keeps pixel-stepped motion aligned.
  const petPx = $derived(grid.size > 0 ? size / grid.size : 1);
</script>

<svg
  viewBox={`0 0 ${grid.size} ${grid.size}`}
  width={size}
  height={size}
  role="img"
  aria-label={title || 'pixel sprite'}
  data-anim={animation}
  class={className}
  style={`--pet-px: ${petPx}px;`}
>
  {#if title}<title>{title}</title>{/if}
  {#each pixels as p (p.x + ',' + p.y)}
    <rect x={p.x} y={p.y} width="1" height="1" fill={p.color} />
  {/each}
</svg>

<style>
  svg {
    shape-rendering: crispedges;
    image-rendering: pixelated;
    /* Squash from the feet, not the centre. */
    transform-origin: 50% 100%;
  }

  /* Spin and float read better rotating/drifting about the centre. */
  svg[data-anim='spin'],
  svg[data-anim='float'] {
    transform-origin: 50% 50%;
  }

  svg[data-anim='idle'] {
    animation: bob 1s steps(1, end) infinite;
  }

  svg[data-anim='happy'] {
    animation: hop 0.9s cubic-bezier(0.36, 0.07, 0.19, 0.97) infinite;
  }

  svg[data-anim='breathe'] {
    animation: breathe 2.6s ease-in-out infinite;
  }

  svg[data-anim='float'] {
    animation: float 3s ease-in-out infinite;
  }

  svg[data-anim='wiggle'] {
    animation: wiggle 1.1s ease-in-out infinite;
  }

  svg[data-anim='jump'] {
    animation: jump 1.1s cubic-bezier(0.3, 0.1, 0.3, 1) infinite;
  }

  svg[data-anim='spin'] {
    animation: spin 2s linear infinite;
  }

  /* Two-frame bob: snaps up by exactly one grid pixel and back. */
  @keyframes bob {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(calc(-1 * var(--pet-px)));
    }
  }

  /* Squash-and-stretch hop: anticipation crouch → airborne → landing squash. */
  @keyframes hop {
    0%,
    88%,
    100% {
      transform: translateY(0) scale(1, 1);
    }
    12% {
      transform: translateY(0) scale(1.12, 0.88);
    }
    42% {
      transform: translateY(-28%) scale(0.94, 1.08);
    }
    68% {
      transform: translateY(0) scale(1.08, 0.92);
    }
  }

  /* Gentle in-place stretch, like a slow breath. */
  @keyframes breathe {
    0%,
    100% {
      transform: scale(1, 1);
    }
    50% {
      transform: scale(0.98, 1.04);
    }
  }

  /* Smooth vertical drift. */
  @keyframes float {
    0%,
    100% {
      transform: translateY(6%);
    }
    50% {
      transform: translateY(-6%);
    }
  }

  /* Rocks side to side from the feet. */
  @keyframes wiggle {
    0%,
    100% {
      transform: rotate(0deg);
    }
    30% {
      transform: rotate(-5deg);
    }
    70% {
      transform: rotate(5deg);
    }
  }

  /* A taller hop: crouch, spring up with a stretch, land with a squash. */
  @keyframes jump {
    0%,
    62%,
    100% {
      transform: translateY(0) scale(1, 1);
    }
    14% {
      transform: translateY(0) scale(1.14, 0.86);
    }
    36% {
      transform: translateY(-48%) scale(0.92, 1.08);
    }
    52% {
      transform: translateY(0) scale(1.12, 0.88);
    }
  }

  /* Horizontal flip, like turning around. */
  @keyframes spin {
    0% {
      transform: perspective(240px) rotateY(0deg);
    }
    100% {
      transform: perspective(240px) rotateY(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    svg[data-anim] {
      animation: none;
    }
  }
</style>
