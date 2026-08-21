/**
 * Curated word lists for the config playground's data generator.
 *
 * These exist so generated data looks plausible without ever naming a real
 * person or a reachable domain: the names are common enough to identify
 * nobody, and every domain is drawn from the RFC 2606 reserved set
 * (example.com/org/net, the .example and .invalid TLDs), which can never
 * resolve. Hand-rolled lists cost ~2 KB; faker costs 416 KB for the same job.
 */

/** Common lowercase English nouns and adjectives for string values. */
export const WORDS: readonly string[] = [
  'amber', 'anchor', 'apple', 'autumn', 'basket', 'beacon', 'birch', 'bold',
  'brass', 'breeze', 'bright', 'bronze', 'calm', 'canyon', 'cedar', 'cherry',
  'clay', 'clear', 'cloud', 'clover', 'coast', 'copper', 'coral', 'cotton',
  'crisp', 'dawn', 'deep', 'delta', 'drift', 'dusk', 'eager', 'early',
  'ember', 'fable', 'fern', 'field', 'flint', 'forest', 'fresh', 'frost',
  'garden', 'gentle', 'glade', 'golden', 'grove', 'harbor', 'hazel', 'hollow',
  'humble', 'indigo', 'iron', 'ivory', 'jade', 'keen', 'lake', 'lantern',
  'lively', 'lunar', 'maple', 'marble', 'meadow', 'mellow', 'mild', 'misty',
  'north', 'oak', 'ocean', 'olive', 'opal', 'orchard', 'pale', 'pebble',
  'pine', 'plain', 'plum', 'prairie', 'quiet', 'rapid', 'raven', 'ridge',
  'river', 'rustic', 'sage', 'silver', 'slate', 'solar', 'spruce', 'steady',
  'stone', 'summit', 'swift', 'timber', 'valley', 'velvet', 'walnut', 'willow',
];

/** Given names across many cultures — common ones, so they point at no one. */
export const FIRST_NAMES: readonly string[] = [
  'Aiko', 'Amara', 'Anders', 'Bilal', 'Carmen', 'Chen', 'Dmitri', 'Elena',
  'Farah', 'Hana', 'Ines', 'Jasper', 'Kwame', 'Leila', 'Mateo', 'Mei',
  'Noor', 'Oskar', 'Priya', 'Ravi', 'Sofia', 'Tariq', 'Wren', 'Yuki',
];

/** Family names, same rule: common, varied, identifying nobody. */
export const LAST_NAMES: readonly string[] = [
  'Abara', 'Bergstrom', 'Castillo', 'Dubois', 'Fernandez', 'Haddad', 'Ivanov',
  'Jensen', 'Kaur', 'Kimura', 'Kowalski', 'Larsen', 'Mbeki', 'Moreau',
  'Nakamura', 'Novak', 'Okafor', 'Osei', 'Patel', 'Rossi', 'Santos', 'Silva',
  'Tanaka', 'Yilmaz',
];

/** ONLY RFC 2606 reserved names: these can never resolve to a real host. */
export const DOMAINS: readonly string[] = [
  'example.com', 'example.org', 'example.net', 'mail.example', 'app.example',
  'demo.example', 'staging.example', 'test.invalid',
];

/** Short path segments for generated URIs. */
export const URI_PATHS: readonly string[] = [
  'docs', 'settings', 'about', 'pricing', 'blog', 'status', 'help', 'api',
  'login', 'search', 'projects', 'reports',
];
