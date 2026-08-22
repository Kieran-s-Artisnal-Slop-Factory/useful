/**
 * The ONE Prism entry point. The grammar component files are side-effect
 * scripts that assume the `Prism` global already exists — they must evaluate
 * AFTER the core. That ordering is only guaranteed while a single module
 * imports them (Rollup preserves this module's import order; with two
 * importers the grammars land in a shared chunk that can run before the
 * core — exactly the hydration crash the regex tool hit). Import Prism from
 * here, never from 'prismjs' directly.
 */
import Prism from 'prismjs';
// Bundled grammars beyond Prism's default markup/css/clike/javascript.
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-csv';

export default Prism;
