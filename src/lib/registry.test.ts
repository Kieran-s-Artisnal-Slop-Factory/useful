import { describe, expect, it } from 'vitest';
import { hasIcon } from './icons';
import { byCategory, CATEGORY_ORDER, REGISTRY, searchRegistry } from './registry';

describe('registry shape', () => {
  it('has unique ids', () => {
    const ids = REGISTRY.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses app-absolute routes with a trailing slash (base-path safety)', () => {
    for (const tool of REGISTRY) {
      expect(tool.route, tool.id).toMatch(/^\/([a-z0-9-]+\/)*$/);
    }
  });

  it('only uses categories that CATEGORY_ORDER knows, so sidebar order is deliberate', () => {
    for (const tool of REGISTRY) {
      expect(CATEGORY_ORDER, tool.id + ' category "' + tool.category + '"').toContain(tool.category);
    }
  });

  it('every icon key resolves to a real stroke icon', () => {
    for (const tool of REGISTRY) {
      expect(hasIcon(tool.icon), tool.id + ' icon "' + tool.icon + '"').toBe(true);
    }
  });
});

describe('byCategory', () => {
  it('groups every tool exactly once, in CATEGORY_ORDER', () => {
    const groups = byCategory();
    expect(groups.map((g) => g.category)).toEqual(
      CATEGORY_ORDER.filter((c) => REGISTRY.some((t) => t.category === c))
    );
    expect(groups.flatMap((g) => g.tools)).toHaveLength(REGISTRY.length);
  });
});

describe('searchRegistry', () => {
  it('returns everything on an empty query', () => {
    expect(searchRegistry('')).toHaveLength(REGISTRY.length);
    expect(searchRegistry('   ')).toHaveLength(REGISTRY.length);
  });

  it('puts a name match first', () => {
    expect(searchRegistry('sett')[0]!.id).toBe('settings');
    expect(searchRegistry('home')[0]!.id).toBe('home');
  });

  it('finds tools by alias', () => {
    expect(searchRegistry('prefs').map((t) => t.id)).toContain('preferences');
    expect(searchRegistry('backup').map((t) => t.id)).toContain('settings');
  });

  it('ranks name matches above alias matches', () => {
    // "restore" is an alias of Settings; a tool NAMED anything matching the
    // query must come first. Guard the tiering with a synthetic pair.
    const tools = [
      { id: 'a', name: 'Restore point', description: '', aliases: [], category: 'App', route: '/a/', icon: 'x' },
      { id: 'b', name: 'Other', description: '', aliases: ['restore'], category: 'App', route: '/b/', icon: 'x' },
    ];
    expect(searchRegistry('restore', tools)[0]!.id).toBe('a');
  });

  it('returns nothing for a query nothing matches', () => {
    expect(searchRegistry('qqqqxyz')).toHaveLength(0);
  });
});
