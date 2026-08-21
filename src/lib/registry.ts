/**
 * The tool registry — the single source of truth for every page in the app.
 *
 * The sidebar, the home screen, and the ctrl+k quick-action palette all render
 * from this list, so adding a tool here is what makes it navigable and
 * searchable; nothing else needs to know it exists. Each phase of
 * docs/dev/plans/plan-phases.md appends its tools here (and adds the page to
 * SHELL in public/sw.js).
 *
 * Routes are app-absolute with a trailing slash and MUST be rendered through
 * href() from src/lib/paths.ts so they stay correct under a sub-path base.
 */
import { fuzzyScore } from './fuzzy';

export interface ToolDef {
  /** Stable slug, used as the key in lists. */
  id: string;
  name: string;
  /** One line shown in the palette and on home tiles. */
  description: string;
  /** Extra search terms ("tz", "cmd+k"…) the name doesn't contain. */
  aliases: string[];
  category: string;
  /** App-absolute route with trailing slash, e.g. '/settings/'. */
  route: string;
  /** Stroke-icon key from src/lib/icons.ts (rendered by Icon.svelte). */
  icon: string;
}

/**
 * Category display order for the sidebar and home screen. Tool categories
 * land here as their phases ship (Time, Scheduler, Images, Calculators,
 * Generators); 'App' stays last — it holds the app's own pages.
 */
export const CATEGORY_ORDER: string[] = [
  'Time',
  'Scheduler',
  'Images',
  'Calculators',
  'Generators',
  'Playgrounds',
  'App',
];

export const REGISTRY: ToolDef[] = [
  {
    id: 'timers',
    name: 'Timers',
    description: 'Countdown timers with sound, vibration and notifications',
    aliases: ['countdown', 'alarm', 'pomodoro'],
    category: 'Time',
    route: '/tools/timers/',
    icon: 'timer',
  },
  {
    id: 'stopwatch',
    name: 'Stopwatch',
    description: 'Elapsed time with laps',
    aliases: ['laps', 'chronometer', 'elapsed'],
    category: 'Time',
    route: '/tools/stopwatch/',
    icon: 'watch',
  },
  {
    id: 'timezones',
    name: 'Timezones',
    description: 'Convert a time between any two timezones',
    aliases: ['tz', 'time zone', 'utc', 'conversion', 'world clock'],
    category: 'Time',
    route: '/tools/timezones/',
    icon: 'globe',
  },
  {
    id: 'scheduler',
    name: 'Scheduler',
    description: 'Events and TODOs on a list, board, or calendar',
    aliases: ['todo', 'todos', 'tasks', 'kanban', 'calendar', 'events', 'agenda'],
    category: 'Scheduler',
    route: '/tools/scheduler/',
    icon: 'calendar-days',
  },
  {
    id: 'number-conversion',
    name: 'Programming',
    description: 'Binary, octal, decimal and hex with bit-width operations',
    aliases: ['number conversion', 'binary', 'hex', 'hexadecimal', 'octal', 'decimal', 'base', 'twos complement', 'ones complement', 'bitwise not', 'bits', 'coding'],
    category: 'Calculators',
    route: '/tools/number-conversion/',
    icon: 'binary',
  },
  {
    id: 'photography',
    name: 'Photography',
    description: 'Equivalent settings across sensor formats, and light-stop differences',
    aliases: ['equivalent settings', 'light stops', 'aperture', 'iso', 'crop factor', 'exposure', 'f-stop', 'sensor', 'camera'],
    category: 'Calculators',
    route: '/tools/photography/',
    icon: 'camera',
  },
  {
    id: 'file-transfer',
    name: 'File transfer',
    description: 'How long a file takes to move at a given network speed',
    aliases: ['download time', 'bandwidth', 'network speed', 'upload', 'mbps', 'transfer time', 'bits', 'bytes'],
    category: 'Calculators',
    route: '/tools/file-transfer/',
    icon: 'hard-drive-download',
  },
  {
    id: 'image-converter',
    name: 'Image converter',
    description: 'SVG, AVIF, WebP, TIFF, PNG or JPG in — PNG or JPG out',
    // No 'heic' alias: the converter rejects HEIC (no browser decoder), and an
    // alias that lands you on a tool which refuses your file is worse than no
    // result at all.
    aliases: ['convert image', 'svg to png', 'webp to png', 'avif to jpg', 'tiff', 'png to jpg', 'jpg to png'],
    category: 'Images',
    route: '/tools/image-converter/',
    icon: 'image',
  },
  {
    id: 'image-resizer',
    name: 'Image resizer',
    description: 'Resize to exact dimensions or a percentage, aspect locked',
    aliases: ['resize image', 'scale image', 'shrink image', 'dimensions', 'thumbnail'],
    category: 'Images',
    route: '/tools/image-resizer/',
    icon: 'scaling',
  },
  {
    id: 'image-compressor',
    name: 'Image compressor',
    description: 'Recompress JPG/PNG with quality and size caps, before/after sizes',
    aliases: ['compress image', 'optimize image', 'smaller image', 'jpg quality', 'file size'],
    category: 'Images',
    route: '/tools/image-compressor/',
    icon: 'shrink',
  },
  {
    id: 'background-remover',
    name: 'Background remover',
    description: 'Cut the subject out of a photo with an on-device model',
    aliases: [
      'remove background',
      'cutout',
      'cut out',
      'transparent background',
      'segmentation',
      'matting',
      'remove bg',
      'u2net',
      'ai',
    ],
    category: 'Images',
    route: '/tools/background-remover/',
    icon: 'scissors',
  },
  {
    id: 'svg-editor',
    name: 'SVG editor',
    description: 'Draw layered SVGs: shapes, bezier lines, polygons, text and pasted markup',
    aliases: ['vector', 'draw', 'shapes', 'bezier', 'polygon', 'icon editor', 'illustrator'],
    category: 'Images',
    route: '/tools/svg-editor/',
    icon: 'pen-tool',
  },
  {
    id: 'image-editor',
    name: 'Image editor',
    description: 'Annotate photos: crop, rotate, draw, arrows, text, blur — and edit EXIF',
    aliases: ['raster', 'photo editor', 'annotate', 'crop', 'rotate', 'blur', 'exif', 'metadata', 'markup'],
    category: 'Images',
    route: '/tools/image-editor/',
    icon: 'brush',
  },
  {
    id: 'sprite-editor',
    name: 'Sprite editor',
    description: 'Draw pixel art on a character grid, with a colour legend',
    aliases: ['pixel', 'pixel art', 'sprite', 'pixels', 'game art', 'icon', '8-bit'],
    category: 'Images',
    route: '/tools/sprite-editor/',
    icon: 'grid-2x2',
  },
  {
    id: 'sql-playground',
    name: 'SQL playground',
    description: 'Run real SQLite or Postgres in the browser — nothing leaves the tab',
    aliases: [
      'sql',
      'database',
      'sqlite',
      'postgres',
      'postgresql',
      'pglite',
      'query',
      'db',
      'playground',
      'scratch database',
    ],
    category: 'Playgrounds',
    route: '/tools/sql-playground/',
    icon: 'database',
  },
  {
    id: 'config-playground',
    name: 'Config playground',
    description: 'Understand, validate and generate JSON and YAML',
    aliases: [
      'config',
      'configuration',
      'json',
      'yaml',
      'yml',
      'schema',
      'validate',
      'lint',
      'prettify',
      'sample data',
      'faker',
      'codegen',
    ],
    category: 'Playgrounds',
    route: '/tools/config-playground/',
    icon: 'braces',
  },
  {
    id: 'napkin-math',
    name: 'Napkin math',
    description: 'Formulas that document themselves, with code you can take away',
    aliases: [
      'napkin', 'formula', 'equation', 'math', 'maths', 'calculation', 'template',
      'back of the envelope', 'estimate', 'latex', 'codegen',
    ],
    category: 'Calculators',
    route: '/tools/napkin-math/',
    icon: 'sigma',
  },
  {
    id: 'logo-generator',
    name: 'Logo generator',
    description: 'Seeded avatars, identicons, and icon or emoji badges',
    aliases: ['logo', 'icon', 'avatar', 'identicon', 'dicebear', 'jdenticon', 'badge', 'app icon', 'favicon'],
    category: 'Generators',
    route: '/tools/logo-generator/',
    icon: 'hexagon',
  },
  {
    id: 'secrets',
    name: 'Secrets',
    description: 'Passwords, API keys, JWT secrets, UUIDs and Wi-Fi passphrases',
    aliases: ['password', 'passphrase', 'key', 'token', 'uuid', 'jwt', 'api key', 'wpa', 'wifi', 'random', 'generate'],
    category: 'Generators',
    route: '/tools/secrets/',
    icon: 'key-round',
  },
  {
    id: 'colors',
    name: 'Themes',
    description: 'Color conversion, harmonies, and a CSS variable theme builder',
    aliases: ['colors', 'color', 'hex', 'rgb', 'rgba', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'picker', 'named colors', 'color wheel', 'harmony', 'complementary', 'palette', 'design tokens', 'css variables', 'light-dark'],
    category: 'Generators',
    route: '/tools/colors/',
    icon: 'palette',
  },
  {
    id: 'gradients',
    name: 'Gradients',
    description: 'Build linear, radial and conic CSS gradients with live preview',
    aliases: ['gradient', 'linear-gradient', 'radial', 'conic', 'css background'],
    category: 'Generators',
    route: '/tools/gradients/',
    icon: 'blend',
  },
  {
    id: 'glassmorphism',
    name: 'Glassmorphism',
    description: 'Frosted-glass panel CSS: backdrop blur, tint and border',
    aliases: ['glass', 'frosted', 'blur', 'backdrop-filter', 'acrylic'],
    category: 'Generators',
    route: '/tools/glassmorphism/',
    icon: 'layers',
  },
  {
    id: 'regex',
    name: 'Regex snippets',
    description: 'Turn a regex into Go, Rust, JavaScript and Python code',
    aliases: ['regular expression', 'pattern', 'go', 'rust', 'python', 'javascript', 're2', 'grep'],
    category: 'Generators',
    route: '/tools/regex/',
    icon: 'regex',
  },
  {
    id: 'qr',
    name: 'QR code',
    description: 'Create QR codes (PNG/SVG) and read them from images or camera',
    aliases: ['qr code', 'barcode', 'scanner', 'qr reader', 'qr generator'],
    category: 'Generators',
    route: '/tools/qr/',
    icon: 'qr-code',
  },
  {
    id: 'home',
    name: 'Home',
    description: 'Overview of every tool',
    aliases: ['start', 'index', 'overview'],
    category: 'App',
    route: '/',
    icon: 'house',
  },
  {
    id: 'preferences',
    name: 'Preferences',
    description: 'Per-tool defaults and remembered values',
    aliases: ['prefs', 'defaults', 'options'],
    category: 'App',
    route: '/preferences/',
    icon: 'sliders-horizontal',
  },
  {
    id: 'settings',
    name: 'Settings',
    description: 'Theme, storage, backup and restore',
    aliases: ['theme', 'backup', 'restore', 'export', 'import', 'dark mode'],
    category: 'App',
    route: '/settings/',
    icon: 'settings',
  },
];

/** Registry grouped for the sidebar: categories in CATEGORY_ORDER, then any strays. */
export function byCategory(): { category: string; tools: ToolDef[] }[] {
  const known = new Set(CATEGORY_ORDER);
  const strays = [...new Set(REGISTRY.map((t) => t.category))].filter((c) => !known.has(c));
  return [...CATEGORY_ORDER, ...strays]
    .map((category) => ({ category, tools: REGISTRY.filter((t) => t.category === category) }))
    .filter((g) => g.tools.length > 0);
}

/**
 * Rank tools for the palette. Name matches outrank alias matches, which
 * outrank category/description matches — searching "set" must surface
 * Settings before anything that merely mentions settings.
 */
export function searchRegistry(query: string, tools: ToolDef[] = REGISTRY): ToolDef[] {
  const q = query.trim();
  if (q.length === 0) return [...tools];
  return tools
    .map((tool) => {
      const name = fuzzyScore(q, tool.name);
      const alias = best(tool.aliases.map((a) => fuzzyScore(q, a)));
      const rest = best([fuzzyScore(q, tool.category), fuzzyScore(q, tool.description)]);
      let score: number | null = null;
      if (name !== null) score = 400 + name;
      else if (alias !== null) score = 200 + alias;
      else if (rest !== null) score = rest;
      return { tool, score };
    })
    .filter((r): r is { tool: ToolDef; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .map((r) => r.tool);
}

function best(scores: (number | null)[]): number | null {
  const real = scores.filter((s): s is number => s !== null);
  return real.length > 0 ? Math.max(...real) : null;
}
