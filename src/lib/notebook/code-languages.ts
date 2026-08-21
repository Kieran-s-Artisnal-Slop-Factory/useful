/**
 * The language list for Crepe's in-editor code blocks.
 *
 * Crepe's CodeMirror feature defaults `languages` to `[]` — with nothing
 * passed, code blocks get no syntax highlighting and the language picker is
 * empty. This supplies CodeMirror's standard set (each entry lazy-loads its
 * grammar on first use, so the bundle cost is per-language-actually-used)
 * plus **mermaid**, which additionally carries our completion source so
 * authors get intellisense while typing a diagram in a fenced block.
 */
import { LanguageDescription, LanguageSupport } from '@codemirror/language';
import { languages as builtinLanguages } from '@codemirror/language-data';
import { EditorState } from '@codemirror/state';
import { mermaidCompletionSource } from './mermaid';

/**
 * mermaid, with completions attached to the language itself.
 *
 * Registered as a `languageData` PROVIDER rather than through
 * `language.data.of(...)`: `codemirror-lang-mermaid` dispatches to a
 * per-diagram grammar (flowchart, sequence, …) after the first line, and
 * per-language data only resolves for whichever grammar covers the cursor —
 * attaching to the top-level language yields completions on line 1 and
 * silence everywhere else. A provider answers for every position. It needs
 * no language check because these extensions are only installed in the
 * CodeMirror instance of a block whose language *is* mermaid.
 */
const mermaidDescription = LanguageDescription.of({
  name: 'mermaid',
  alias: ['mmd'],
  extensions: ['mmd', 'mermaid'],
  async load() {
    const { mermaid } = await import('codemirror-lang-mermaid');
    const base = mermaid();
    return new LanguageSupport(base.language, [
      base.support,
      EditorState.languageData.of(() => [{ autocomplete: mermaidCompletionSource }]),
    ]);
  },
});

/** Passed to Crepe as `[Crepe.Feature.CodeMirror]: { languages }`. */
export const codeBlockLanguages: LanguageDescription[] = [...builtinLanguages, mermaidDescription];
