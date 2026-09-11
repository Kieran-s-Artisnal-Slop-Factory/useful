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
  'Productivity',
  'Images',
  'Calculators',
  'Generators',
  'Security',
  'DevOps',
  'Playgrounds',
  'App',
];

/**
 * One icon per category, for the sidebar's rail (Phase 14's sidebar: a rail
 * of categories with the chosen category's tools beside it). Names are keys
 * of `ICONS` in lib/icons.ts; a category that is not here falls back to its
 * first tool's icon, so a new category never renders blank.
 */
export const CATEGORY_ICONS: Record<string, string> = {
  Time: 'timer',
  Productivity: 'calendar-days',
  Images: 'image',
  Calculators: 'sigma',
  Generators: 'hexagon',
  Security: 'lock',
  DevOps: 'container',
  Playgrounds: 'braces',
  App: 'settings',
};

export const REGISTRY: ToolDef[] = [
  {
    id: 'timers',
    name: 'Timers',
    description: 'Countdown timers with sound, vibration and notifications',
    aliases: ['countdown', 'alarm'],
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
    id: 'pomodoro',
    name: 'Pomodoro',
    description: 'Focus rounds and breaks on a cycle, with a notice at each turn',
    aliases: ['focus', 'tomato', 'work timer', 'break', 'pomodoro timer'],
    category: 'Time',
    route: '/tools/pomodoro/',
    icon: 'timer-reset',
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
    category: 'Productivity',
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
    id: 'diff',
    name: 'Diff',
    description: 'Compare two texts and see exactly what changed',
    aliases: [
      'diff',
      'compare',
      'comparison',
      'difference',
      'changes',
      'patch',
      'unified diff',
      'text compare',
      'side by side',
    ],
    category: 'Calculators',
    route: '/tools/diff/',
    icon: 'diff',
  },
  {
    id: 'similarity',
    name: 'Similarity',
    description: 'Score one word against many — Jaro, Levenshtein, Damerau and Indel',
    aliases: [
      'similarity',
      'levenshtein',
      'edit distance',
      'jaro',
      'jaro-winkler',
      'damerau',
      'indel',
      'fuzzy',
      'spelling',
      'typo',
      'closest word',
      'string distance',
    ],
    category: 'Calculators',
    route: '/tools/similarity/',
    icon: 'ruler',
  },
  {
    id: 'text-analysis',
    name: 'Text analysis',
    description: 'Counts, reading difficulty, word frequency and case transformations',
    aliases: [
      'word count',
      'character count',
      'counter',
      'letters',
      'readability',
      'difficulty',
      'flesch',
      'kincaid',
      'smog',
      'ari',
      'grade level',
      'reading time',
      'frequency',
      'uppercase',
      'lowercase',
      'sentence case',
      'title case',
      'spongebob',
      'strikethrough',
      'wide text',
    ],
    category: 'Calculators',
    route: '/tools/text-analysis/',
    icon: 'type',
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
    id: 'base64',
    name: 'Base64',
    description: 'Text and images in and out of base64, with data URLs',
    aliases: [
      'base64',
      'base 64',
      'encode',
      'decode',
      'data url',
      'data uri',
      'btoa',
      'atob',
      'image to base64',
      'base64 to image',
      'text encode',
      'url safe',
    ],
    category: 'Images',
    route: '/tools/base64/',
    icon: 'arrow-right-left',
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
    id: 'color-extractor',
    name: 'Color extractor',
    description: 'Pull a palette out of an image, and turn it into a CSS theme',
    aliases: [
      'palette', 'colours', 'colors', 'dominant color', 'dominant colour',
      'swatch', 'eyedropper', 'pipette', 'extract', 'theme from image', 'kmeans',
    ],
    category: 'Images',
    route: '/tools/color-extractor/',
    icon: 'pipette',
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
    id: 'notebook',
    name: 'Notebook',
    description: 'Linked markdown notes — WYSIWYG or source, footnotes, diagrams, export',
    aliases: [
      'notes',
      'note',
      'markdown',
      'wiki',
      'journal',
      'writing',
      'editor',
      'backlinks',
      'footnotes',
      'pdf',
      'export',
    ],
    category: 'Productivity',
    route: '/tools/notebook/',
    icon: 'notebook',
  },
  {
    id: 'http-playground',
    name: 'HTTP playground',
    description: 'Craft a request, send it, and understand what came back',
    aliases: [
      'http',
      'https',
      'rest',
      'api',
      'request',
      'response',
      'fetch',
      'curl',
      'postman',
      'httpie',
      'insomnia',
      'headers',
      'cors',
      'json',
      'get',
      'post',
      'endpoint',
      'client',
    ],
    category: 'Playgrounds',
    route: '/tools/http-playground/',
    icon: 'arrow-up-down',
  },
  {
    id: 'web-playground',
    name: 'Web playground',
    description: 'HTML, CSS and JavaScript with a live sandboxed preview',
    aliases: [
      'html',
      'css',
      'javascript',
      'js',
      'typescript',
      'ts',
      'web',
      'page',
      'frontend',
      'front end',
      'sandbox',
      'preview',
      'playground',
      'scratch',
      'codepen',
      'jsfiddle',
      'emmet',
    ],
    category: 'Playgrounds',
    route: '/tools/web-playground/',
    icon: 'code-xml',
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
    id: 'calories',
    name: 'Daily calories',
    description: 'Resting and maintenance energy, and what to eat to hit a goal',
    aliases: [
      'calorie', 'calories', 'tdee', 'bmr', 'diet', 'deficit', 'surplus',
      'weight loss', 'weight gain', 'mifflin', 'harris benedict',
      'katch mcardle', 'metabolism', 'nutrition',
    ],
    category: 'Calculators',
    route: '/tools/calories/',
    icon: 'flame',
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
    id: 'hashing',
    name: 'Hashing',
    description: 'MD5, SHA-1, SHA-2, SHA-3 and SHAKE, with HMAC, salt and pepper',
    aliases: [
      'hash',
      'hashing',
      'digest',
      'checksum',
      'md5',
      'sha',
      'sha1',
      'sha256',
      'sha512',
      'sha3',
      'shake',
      'keccak',
      'hmac',
      'salt',
      'pepper',
      'fingerprint',
    ],
    category: 'Security',
    route: '/tools/hashing/',
    icon: 'fingerprint',
  },
  {
    id: 'jwt',
    name: 'JWT',
    description: 'Decode, verify and sign JSON Web Tokens — HMAC, RSA, ECDSA, EdDSA',
    aliases: [
      'jwt',
      'json web token',
      'token',
      'bearer',
      'claims',
      'hs256',
      'rs256',
      'es256',
      'eddsa',
      'jose',
      'decode token',
      'verify token',
      'sign token',
    ],
    category: 'Security',
    route: '/tools/jwt/',
    icon: 'ticket',
  },
  {
    id: 'docker-compose',
    name: 'Docker Compose',
    description: 'Build a compose.yaml that knows what each field does, with templates and warnings',
    aliases: [
      'docker',
      'compose',
      'docker compose',
      'compose.yaml',
      'docker-compose.yml',
      'container',
      'containers',
      'services',
      'yaml',
      'stack',
      'wordpress',
      'postgres',
      'redis',
      'healthcheck',
      'devops',
    ],
    category: 'DevOps',
    route: '/tools/docker-compose/',
    icon: 'container',
  },
  {
    id: 'placeholders',
    name: 'Placeholders',
    description: 'Filler text and seeded filler images, drawn here and never fetched',
    aliases: [
      'placeholder',
      'placeholders',
      'lorem',
      'lorem ipsum',
      'filler',
      'filler text',
      'dummy text',
      'dummy image',
      'placeholder image',
      'mock',
      'mockup',
      'stock',
      'noise',
      'flow field',
      'sample text',
    ],
    category: 'Generators',
    route: '/tools/placeholders/',
    icon: 'image-plus',
  },
  {
    id: 'crontab',
    name: 'Crontab',
    description: 'Read and build cron expressions, with the next runs and where the line goes',
    aliases: [
      'cron',
      'crontab',
      'cron expression',
      'schedule',
      'scheduled job',
      'cronjob',
      'cron job',
      'systemd timer',
      'oncalendar',
      'timer',
      'every 5 minutes',
      'crontab.guru',
      'run-parts',
    ],
    category: 'DevOps',
    route: '/tools/crontab/',
    icon: 'alarm-clock-check',
  },
  {
    id: 'file-tree',
    name: 'File tree',
    description: 'Build a directory tree, or read one back from a pasted listing',
    aliases: [
      'tree',
      'file tree',
      'directory tree',
      'folder structure',
      'project structure',
      'ls',
      'dir',
      'tree command',
      'ascii tree',
      'readme tree',
      'folders',
      'listing',
    ],
    category: 'DevOps',
    route: '/tools/file-tree/',
    icon: 'folder-tree',
  },
  {
    id: 'ascii-art',
    name: 'ASCII art',
    description: 'A picture as characters, or words as a banner in thirty-seven FIGlet fonts',
    aliases: [
      'ascii',
      'ascii art',
      'text art',
      'figlet',
      'banner',
      'ansi',
      'image to text',
      'image to ascii',
      'text to ascii',
      'ascii picture',
      'font',
      'fonts',
      'letters',
      'big text',
      'terminal art',
    ],
    category: 'Generators',
    route: '/tools/ascii-art/',
    icon: 'square-asterisk',
  },
  {
    id: 'encryption',
    name: 'Encryption',
    description: 'AES with a password, RSA keys, ECDH key agreement, bcrypt and a one-time pad',
    aliases: [
      'encrypt',
      'decrypt',
      'aes',
      'aes-gcm',
      'rsa',
      'public key',
      'private key',
      'pem',
      'ecdh',
      'diffie-hellman',
      'key exchange',
      'key agreement',
      'bcrypt',
      'password hash',
      'pbkdf2',
      'one-time pad',
      'otp',
      'cipher',
    ],
    category: 'Security',
    route: '/tools/encryption/',
    icon: 'lock',
  },
  {
    id: 'secrets',
    name: 'Secrets',
    description: 'Passwords, API keys, JWT secrets, UUIDs and Wi-Fi passphrases',
    aliases: ['password', 'passphrase', 'key', 'token', 'uuid', 'jwt', 'api key', 'wpa', 'wifi', 'random', 'generate'],
    category: 'Security',
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
    id: 'clip-path',
    name: 'Clip path',
    description: 'Build a CSS clip-path: polygons, circles, ellipses, blinds and waves',
    aliases: ['clip', 'mask', 'polygon', 'shape', 'css shapes', 'wave', 'blinds'],
    category: 'Generators',
    route: '/tools/clip-path/',
    icon: 'shapes',
  },
  // The home page is not a tool: the brand in the top bar is its link, and a
  // sidebar row for it would only duplicate that. Preferences folded into
  // Settings at Phase 14 (one page for everything about the app itself), and
  // the sidebar pins this entry to the foot of its rail as a gear.
  {
    id: 'settings',
    name: 'Settings',
    description: 'Theme, storage, backup, restore, and per-tool preferences',
    aliases: [
      'theme',
      'backup',
      'restore',
      'export',
      'import',
      'dark mode',
      'preferences',
      'prefs',
      'defaults',
      'options',
    ],
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
