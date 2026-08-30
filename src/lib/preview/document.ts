/**
 * The pure half of the sandboxed previewer (0.4.0 plan, decision 4): building
 * the document an iframe will show, injecting the console shim, and deciding
 * whether a `postMessage` payload is one of ours.
 *
 * It lives here rather than inside
 * [SandboxedPreview.svelte](../../components/SandboxedPreview.svelte) because
 * Vitest runs in Node with no DOM — string assembly and the escape guard are
 * the parts worth proving by unit test, and they are also the parts a mistake
 * in is a security bug rather than a cosmetic one.
 *
 * The frame that renders these documents gets `sandbox="allow-scripts"` and
 * NOTHING else. Never `allow-same-origin`: the document is either user code
 * (the web playground) or a *server's* HTML (the HTTP playground's response
 * preview), and either one reaching this app's IndexedDB would be a real
 * vulnerability. Because the frame has no origin, its messages arrive with
 * `event.origin === 'null'`, so the receiving side identifies them by
 * `event.source === frame.contentWindow` and by the channel tag below —
 * checking the origin string would prove nothing.
 */

/** Tags whose closing form has to be neutralised inside injected text. */
export type EscapableTag = 'script' | 'style';

/** Console levels the shim forwards. Anything else is reported as `log`. */
export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

export interface ConsoleMessage {
  level: ConsoleLevel;
  text: string;
}

/** Only the last this many messages are kept; a runaway loop must not grow the tab. */
export const CONSOLE_LIMIT = 50;

/** Longest single message the shim will send. A dumped DOM tree is not a log line. */
export const CONSOLE_MAX_CHARS = 2000;

/** Tags every message from a preview frame, so unrelated `postMessage` traffic is ignored. */
export const CONSOLE_CHANNEL = 'useful-preview-console';

const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error'];

/**
 * Stop text from closing the tag it is being placed inside. `</script` in user
 * JavaScript ends the wrapper element wherever it appears — inside a string,
 * inside a comment, anywhere — because the HTML parser runs before the
 * JavaScript one. `<\/script` is the standard escape and means the same thing
 * to JavaScript; for `<style>` it is not valid CSS, but the rule it breaks was
 * already broken and the alternative is a document that ends early.
 *
 * The match is case-insensitive but the replacement keeps the case that was
 * written — only a backslash is inserted. Rewriting `</SCRIPT>` as
 * `<\/script>` would quietly edit the contents of a user's string.
 */
export function escapeCloseTag(code: string, tag: EscapableTag): string {
  return code.replaceAll(new RegExp(`</${tag}`, 'gi'), (match) => `<\\${match.slice(1)}`);
}

/**
 * Forwards the previewed page's console output, uncaught errors and unhandled
 * rejections to the parent. Injected as the first script in the document so it
 * is installed before anything it is meant to observe.
 *
 * It is deliberately ES5 and defensive: it runs inside someone else's page,
 * where `JSON.stringify` may hit a cycle and `postMessage` may be unavailable,
 * and a shim that throws would break the very code it is reporting on. The
 * original console method is still called, so the browser's own devtools show
 * what they always would.
 */
export const CONSOLE_SHIM = [
  '<script>(function () {',
  '  var CHANNEL = ' + JSON.stringify(CONSOLE_CHANNEL) + ';',
  '  var MAX = ' + CONSOLE_MAX_CHARS + ';',
  '  function show(value) {',
  '    if (typeof value === "string") return value;',
  '    try { return JSON.stringify(value); } catch (e) { return String(value); }',
  '  }',
  '  function send(level, args) {',
  '    try {',
  '      var text = Array.prototype.map.call(args, show).join(" ");',
  '      if (text.length > MAX) text = text.slice(0, MAX) + "… (truncated)";',
  '      parent.postMessage({ channel: CHANNEL, level: level, text: text }, "*");',
  '    } catch (e) { /* never break the page we are watching */ }',
  '  }',
  '  ' + JSON.stringify(LEVELS) + '.forEach(function (level) {',
  '    var original = console[level];',
  '    console[level] = function () {',
  '      send(level, arguments);',
  '      if (original) original.apply(console, arguments);',
  '    };',
  '  });',
  '  addEventListener("error", function (event) {',
  '    send("error", [event.message || String(event.error)]);',
  '  });',
  '  addEventListener("unhandledrejection", function (event) {',
  '    send("error", ["Unhandled rejection: " + event.reason]);',
  '  });',
  // `\/` is just `/` to JavaScript; it is written that way so this file never
  // contains the literal characters that would end a <script> element early.
  '})();<\/script>',
].join('\n');

const HEAD_OPEN = /<head[^>]*>/i;
const HTML_OPEN = /<html[^>]*>/i;
const DOCTYPE = /^\s*<!doctype[^>]*>/i;

/**
 * Put the shim in front of everything that could log. `<head>` first, then
 * `<html>`, then after the doctype — never *before* a doctype, because a
 * document whose first node is a `<script>` renders in quirks mode and a
 * previewer that silently changes the box model is worse than useless.
 *
 * The regexes are deliberately shallow: this runs over a server's HTML, which
 * may be malformed in any way at all, and the fallback (prepend) is always
 * correct enough to install the shim.
 */
export function injectConsoleShim(document: string): string {
  const at = (index: number): string =>
    document.slice(0, index) + '\n' + CONSOLE_SHIM + '\n' + document.slice(index);

  const head = HEAD_OPEN.exec(document);
  if (head) return at(head.index + head[0].length);

  const html = HTML_OPEN.exec(document);
  if (html) return at(html.index + html[0].length);

  const doctype = DOCTYPE.exec(document);
  if (doctype) return at(doctype[0].length);

  return CONSOLE_SHIM + '\n' + document;
}

export interface PreviewParts {
  /** Body content. User HTML is treated as markup inside `<body>`, not a whole page. */
  html?: string;
  css?: string;
  script?: string;
  /** `module` by default, so `import` works and the script is deferred. */
  scriptType?: string;
}

/**
 * Assemble a preview document from the three buffers. The CSS and the script
 * are the only places foreign text is placed inside a tag, so they are the
 * only places the close-tag guard is needed; the HTML is markup by intent and
 * goes in as written.
 */
export function buildPreviewDocument(parts: PreviewParts): string {
  const { html = '', css = '', script = '', scriptType = 'module' } = parts;
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<style>${escapeCloseTag(css, 'style')}</style>`,
    '</head>',
    '<body>',
    html,
    `<script type="${scriptType}">${escapeCloseTag(script, 'script')}<\/script>`,
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * Is this `postMessage` payload one of ours? The caller checks
 * `event.source === frame.contentWindow` as well — this is the shape half, and
 * neither check is sufficient alone.
 */
export function isConsoleMessage(data: unknown): data is ConsoleMessage & { channel: string } {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Record<string, unknown>;
  return (
    message.channel === CONSOLE_CHANNEL &&
    typeof message.level === 'string' &&
    LEVELS.includes(message.level as ConsoleLevel) &&
    typeof message.text === 'string'
  );
}

/** Append a message to the strip, keeping only the last {@link CONSOLE_LIMIT}. */
export function appendMessage(
  messages: readonly ConsoleMessage[],
  next: ConsoleMessage
): ConsoleMessage[] {
  return [...messages, next].slice(-CONSOLE_LIMIT);
}
