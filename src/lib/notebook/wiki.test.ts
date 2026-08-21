import { describe, expect, it } from 'vitest';
import {
  backlinks,
  displayTitle,
  findWikiLinks,
  makeBacklinkIndex,
  normalizeTitle,
  resolveNote,
  rewriteWikiLinks,
} from './wiki';

const titles = (md: string) => findWikiLinks(md).map((l) => l.title);

describe('findWikiLinks', () => {
  it('finds a bare link with its offsets', () => {
    const md = 'see [[Ada Lovelace]] today';
    expect(findWikiLinks(md)).toEqual([{ title: 'Ada Lovelace', label: 'Ada Lovelace', from: 4, to: 20 }]);
    expect(md.slice(4, 20)).toBe('[[Ada Lovelace]]');
  });

  it('splits a label off at the first pipe', () => {
    expect(findWikiLinks('[[Ada|her]]')).toEqual([{ title: 'Ada', label: 'her', from: 0, to: 11 }]);
  });

  it('trims title and label; an empty label falls back to the title', () => {
    expect(findWikiLinks('[[ Ada | ]]')[0]).toMatchObject({ title: 'Ada', label: 'Ada' });
    expect(findWikiLinks('[[ Ada |  her  ]]')[0]).toMatchObject({ title: 'Ada', label: 'her' });
  });

  it('ignores empty brackets and brackets spanning a newline', () => {
    expect(titles('[[]] [[ ]] [[a\nb]]')).toEqual([]);
  });

  it('skips links inside fenced code', () => {
    const md = 'x [[one]]\n\n```\n[[two]]\n```\n\n[[three]]';
    expect(titles(md)).toEqual(['one', 'three']);
  });

  it('skips links inside inline code', () => {
    expect(titles('`[[code]]` and [[prose]] and ``[[more]]``')).toEqual(['prose']);
  });

  it('a leading backslash escapes a link; an escaped backslash does not', () => {
    expect(titles('\\[[nope]] [[yes]]')).toEqual(['yes']);
    expect(titles('\\\\[[yes]]')).toEqual(['yes']);
  });

  it('reads unicode titles back from the original string', () => {
    const md = '`code` [[ünï 😀|émoji]]';
    const [link] = findWikiLinks(md);
    expect(link).toMatchObject({ title: 'ünï 😀', label: 'émoji' });
    expect(md.slice(link!.from, link!.to)).toBe('[[ünï 😀|émoji]]');
  });

  it('handles adjacent links', () => {
    expect(titles('[[a]][[b]][[c|d]]')).toEqual(['a', 'b', 'c']);
  });

  it('a bracket inside the title breaks the link', () => {
    expect(titles('[[a [b]] c]]')).toEqual([]);
    expect(titles('[[a]] [[b] c]] [[d]]')).toEqual(['a', 'd']);
  });
});

describe('normalizeTitle / displayTitle', () => {
  it('trims, collapses whitespace and case-folds', () => {
    expect(normalizeTitle('  Ada   Lovelace \n')).toBe('ada lovelace');
    expect(displayTitle('  Ada   Lovelace ')).toBe('Ada Lovelace');
  });

  it('NFC-normalizes so composed and decomposed forms compare equal', () => {
    expect(normalizeTitle('é')).toBe(normalizeTitle('é'));
  });
});

const notes = [
  { id: '1', title: 'Ada Lovelace', aliases: ['Ada', 'Countess'] },
  { id: '2', title: 'Charles Babbage', aliases: ['a', 'b', 'ünï 😀', 3] },
  { id: '3', title: 'ada', aliases: 'junk' },
];

describe('resolveNote', () => {
  it('matches the title case-insensitively, before any alias', () => {
    // 'Ada' is both note 1's alias and note 3's title: the title wins.
    expect(resolveNote(notes, 'ADA')?.id).toBe('3');
    expect(resolveNote(notes, 'ada lovelace')?.id).toBe('1');
  });

  it('falls back to aliases case-insensitively', () => {
    expect(resolveNote(notes, 'countess')?.id).toBe('1');
    expect(resolveNote(notes, 'ÜNÏ 😀')?.id).toBe('2');
  });

  it('tolerates junk in the aliases column', () => {
    expect(resolveNote(notes, '3')).toBeNull();
    expect(resolveNote(notes, 'junk')).toBeNull();
    expect(resolveNote(notes, '')).toBeNull();
  });
});

describe('rewriteWikiLinks', () => {
  it('rewrites the title, keeps labels, and leaves everything else alone', () => {
    const md = 'a [[Old]] b [[old|Label]] c [[Other]] `[[Old]]`\n```\n[[Old]]\n```\n';
    expect(rewriteWikiLinks(md, 'OLD', 'New')).toBe(
      'a [[New]] b [[New|Label]] c [[Other]] `[[Old]]`\n```\n[[Old]]\n```\n'
    );
  });

  it('returns the same string when nothing matches', () => {
    const md = 'no [[links]] here';
    expect(rewriteWikiLinks(md, 'absent', 'x')).toBe(md);
    expect(rewriteWikiLinks(md, '', 'x')).toBe(md);
  });

  it('keeps the label exactly as written, spaces included', () => {
    expect(rewriteWikiLinks('[[Old | the label ]]', 'old', 'New')).toBe('[[New| the label ]]');
  });
});

const linkNotes = [
  { id: 't', title: 'Target', body_md: 'I link to [[Target]] myself', aliases: ['Old Name'] },
  { id: 'a', title: 'Beta', body_md: '[[target]] and [[Old name|alias]] and `[[Target]]`', aliases: [] },
  { id: 'b', title: 'Alpha', body_md: 'just [[TARGET]]', aliases: [] },
  { id: 'c', title: 'Gamma', body_md: 'nothing here', aliases: [] },
];

describe('backlinks', () => {
  it('counts links by title or alias, excludes the target, sorts by title', () => {
    const result = backlinks(linkNotes, linkNotes[0]!);
    expect(result.map((b) => [b.note.id, b.count])).toEqual([
      ['b', 1],
      ['a', 2],
    ]);
  });

  it('is empty for a note nobody links to', () => {
    expect(backlinks(linkNotes, linkNotes[3]!)).toEqual([]);
  });

  it('survives a body that is not a string', () => {
    const junk = [...linkNotes, { id: 'j', title: 'J', body_md: 42 as unknown as string, aliases: [] }];
    expect(backlinks(junk, linkNotes[0]!).map((b) => b.note.id)).toEqual(['b', 'a']);
  });
});

describe('makeBacklinkIndex', () => {
  it('answers like backlinks and rescans only when updated_at changes', () => {
    const index = makeBacklinkIndex<(typeof linkNotes)[number] & { updated_at?: string }>();
    const stamped = linkNotes.map((n) => ({ ...n, updated_at: '1' }));
    expect(index.backlinksOf(stamped, stamped[0]!).map((b) => b.note.id)).toEqual(['b', 'a']);
    expect(index.size).toBe(3);

    // Same version, changed body: the cached scan is trusted.
    const stale = stamped.map((n) => (n.id === 'b' ? { ...n, body_md: 'gone' } : n));
    expect(index.backlinksOf(stale, stale[0]!).map((b) => b.note.id)).toEqual(['b', 'a']);

    // New version: rescanned.
    const fresh = stale.map((n) => (n.id === 'b' ? { ...n, updated_at: '2' } : n));
    expect(index.backlinksOf(fresh, fresh[0]!).map((b) => b.note.id)).toEqual(['a']);
  });
});
