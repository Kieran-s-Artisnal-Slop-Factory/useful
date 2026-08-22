/**
 * Inline stroke icons — the inner markup of selected Lucide icons
 * (https://lucide.dev, ISC license), rendered by src/components/Icon.svelte
 * inside a 24×24 viewBox with `stroke: currentColor; fill: none`.
 *
 * Hand-inlined rather than depending on a package: the app needs a handful of
 * glyphs, they must bundle statically (offline PWA), and stroke-drawn line
 * icons are the blueprint language — add new entries here as tools ship, and
 * reference them by key from the registry's `icon` field.
 */
export const ICONS: Record<string, string> = {
  house:
    '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
    '<polyline points="9 22 9 12 15 12 15 22"/>',
  'sliders-horizontal':
    '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/>' +
    '<line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/>' +
    '<line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/>' +
    '<line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/>' +
    '<line x1="16" x2="16" y1="18" y2="22"/>',
  timer:
    '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/>' +
    '<circle cx="12" cy="14" r="8"/>',
  watch:
    '<circle cx="12" cy="12" r="6"/><polyline points="12 10 12 12 13 13"/>' +
    '<path d="m16.13 7.66-.81-4.05a2 2 0 0 0-2-1.61h-2.68a2 2 0 0 0-2 1.61l-.78 4.05"/>' +
    '<path d="m7.88 16.36.8 4a2 2 0 0 0 2 1.61h2.72a2 2 0 0 0 2-1.61l.81-4.05"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/>' +
    '<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>' +
    '<path d="M2 12h20"/>',
  'calendar-days':
    '<path d="M8 2v4"/><path d="M16 2v4"/>' +
    '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>' +
    '<path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/>' +
    '<path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
  binary:
    '<rect x="14" y="14" width="4" height="6" rx="2"/><rect x="6" y="4" width="4" height="6" rx="2"/>' +
    '<path d="M6 20h4"/><path d="M14 10h4"/><path d="M6 14h2v6"/><path d="M14 4h2v6"/>',
  camera:
    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>' +
    '<circle cx="12" cy="13" r="3"/>',
  'hard-drive-download':
    '<path d="M12 2v8"/><path d="m16 6-4 4-4-4"/>' +
    '<rect width="20" height="8" x="2" y="14" rx="2"/>' +
    '<path d="M6 18h.01"/><path d="M10 18h.01"/>',
  palette:
    '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>' +
    '<circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>' +
    '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  blend: '<circle cx="9" cy="9" r="7"/><circle cx="15" cy="15" r="7"/>',
  layers:
    '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>' +
    '<path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>' +
    '<path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  regex:
    '<path d="M17 3v10"/><path d="m12.67 5.5 8.66 5"/><path d="m12.67 10.5 8.66-5"/>' +
    '<path d="M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z"/>',
  // Lucide "key-round".
  // Lucide "grid-2x2" — a pixel grid.
  // Lucide "sigma".
  sigma: '<path d="M18 7V4H6l6 8-6 8h12v-3"/>',
  // Lucide "hexagon".
  hexagon:
    '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
  'grid-2x2':
    '<path d="M12 3v18"/><path d="M3 12h18"/>' +
    '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  'key-round':
    '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/>' +
    '<circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  'qr-code':
    '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/>' +
    '<rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/>' +
    '<path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/>' +
    '<path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/>' +
    '<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  scaling:
    '<path d="M21 3 9 15"/><path d="M12 3H3v18h18v-9"/><path d="M16 3h5v5"/><path d="M14 15H9v-5"/>',
  shrink:
    '<path d="m15 15 6 6"/><path d="m15 9 6-6"/><path d="M15 19.8V15h4.8"/>' +
    '<path d="M15 4.2V9h4.8"/><path d="m9 15-6 6"/><path d="M4.2 15H9v4.8"/>' +
    '<path d="M4.2 9H9V4.2"/><path d="M9 9 3 3"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>' +
    '<circle cx="12" cy="12" r="3"/>',
  'pen-tool':
    '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/>' +
    '<path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/>' +
    '<path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/>',
  database:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/>' +
    '<path d="M3 12A9 3 0 0 0 21 12"/>',
  // Lucide "notebook" — the notebook.
  notebook:
    '<path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/>' +
    '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M16 2v20"/>',
  // Lucide "braces" — curly brackets, the config playground.
  braces:
    '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/>' +
    '<path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  scissors:
    '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/>' +
    '<circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  // Lucide "ticket" — a token with a perforation, the JWT page.
  ticket:
    '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>' +
    '<path d="M13 5v2"/><path d="M13 11v2"/><path d="M13 17v2"/>',
  // Lucide "lock" — the encryption page.
  lock:
    '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>' +
    '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  // Lucide "fingerprint" — the digest tools.
  fingerprint:
    '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>' +
    '<path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>' +
    '<path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>' +
    '<path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/>' +
    '<path d="M21.8 16c.2-2 .131-5.354 0-6"/>' +
    '<path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/>' +
    '<path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>',
  // Lucide "arrow-right-left" — two arrows passing, encode and decode.
  'arrow-right-left':
    '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  // Lucide "type" — a serif A on its baseline, the text tools.
  type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
  // Lucide "ruler" — measuring the distance between two words.
  ruler:
    '<path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z"/>' +
    '<path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/>',
  // Lucide "diff" — a plus over a minus over a rule, the compare tools.
  diff: '<path d="M12 3v14"/><path d="M5 10h14"/><path d="M5 21h14"/>',
  brush:
    '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/>' +
    '<path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
  // Lucide "square-asterisk" — a punctuation mark framed as a picture, which
  // is what ASCII art is.
  'square-asterisk':
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 8v8"/>' +
    '<path d="m8.5 14 7-4"/><path d="m8.5 10 7 4"/>',
};

export function hasIcon(name: string): boolean {
  return name in ICONS;
}
