/**
 * The message protocol between the web playground and its popped-out preview
 * window.
 *
 * **The popup is same-origin with this app**, and that is the whole reason
 * this file is careful. A window opened with `window.open` inherits the
 * opener's origin, so the popup CAN reach this app's IndexedDB — which means
 * the previewed code must never be the popup's own document. It is not: the
 * popup is a page of ours whose only job is to host the same
 * `SandboxedPreview` iframe, and the user's code runs inside that, with
 * `sandbox="allow-scripts"` and an opaque origin, exactly as it does inline.
 * The popout moves the frame to another window; it does not move the code out
 * of the sandbox.
 *
 * Because both windows ARE ours, messages between them are checked the
 * ordinary way — by origin, which here is a real origin and means something —
 * as well as by the channel tag below. That is the opposite of the shim's
 * situation in [preview/document.ts](../preview/document.ts), where the
 * sender has no origin and only `event.source` can identify it.
 */

import type { ConsoleMessage } from '../preview/document';

/** Tags traffic between the two windows, so nothing else is mistaken for it. */
export const POPOUT_CHANNEL = 'useful-web-playground-popout';

/** The popup's window name — reusing it means one preview window, not five. */
export const POPOUT_WINDOW_NAME = 'useful-web-playground-preview';

/** Sent by the popup once it can accept a document — including after a reload. */
export interface PopoutReady {
  channel: typeof POPOUT_CHANNEL;
  type: 'ready';
}

/** Sent by the editor window on every rebuild. */
export interface PopoutDocument {
  channel: typeof POPOUT_CHANNEL;
  type: 'document';
  srcdoc: string;
}

/** Sent by the popup so the console strip stays beside the code. */
export interface PopoutConsole {
  channel: typeof POPOUT_CHANNEL;
  type: 'console';
  messages: ConsoleMessage[];
}

/** Sent by the editor window when the popout is turned off or it goes away. */
export interface PopoutClose {
  channel: typeof POPOUT_CHANNEL;
  type: 'close';
}

export type PopoutMessage = PopoutReady | PopoutDocument | PopoutConsole | PopoutClose;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Is this one of ours, and the shape it claims to be? */
export function isPopoutMessage(data: unknown): data is PopoutMessage {
  if (!isRecord(data)) return false;
  if (data.channel !== POPOUT_CHANNEL) return false;
  switch (data.type) {
    case 'ready':
    case 'close':
      return true;
    case 'document':
      return typeof data.srcdoc === 'string';
    case 'console':
      return Array.isArray(data.messages);
    default:
      return false;
  }
}

export const readyMessage = (): PopoutReady => ({ channel: POPOUT_CHANNEL, type: 'ready' });

export const documentMessage = (srcdoc: string): PopoutDocument => ({
  channel: POPOUT_CHANNEL,
  type: 'document',
  srcdoc,
});

/**
 * The messages, as PLAIN objects.
 *
 * These cross a `postMessage`, which structured-clones its payload — and a
 * Svelte `$state` array is a Proxy, which structured clone refuses with a
 * `DataCloneError`. The previewer's list is exactly such a proxy, so copying
 * here is what makes the relay work at all; the same hazard is why `repo.ts`
 * JSON-round-trips every row before it reaches IndexedDB. Doing it in the
 * message builder rather than at the call site means no caller has to know.
 */
export const consoleMessage = (messages: readonly ConsoleMessage[]): PopoutConsole => ({
  channel: POPOUT_CHANNEL,
  type: 'console',
  messages: messages.map((message) => ({ level: message.level, text: message.text })),
});

export const closeMessage = (): PopoutClose => ({ channel: POPOUT_CHANNEL, type: 'close' });

/**
 * Roughly the size of the window this app is in, so the preview opens at a
 * shape someone might actually have designed for rather than a browser
 * default. Clamped because a popup larger than the screen opens off it.
 */
export function popoutFeatures(screenWidth: number, screenHeight: number): string {
  const width = Math.max(320, Math.min(1200, Math.round(screenWidth * 0.5)));
  const height = Math.max(320, Math.min(1000, Math.round(screenHeight * 0.8)));
  return `popup=yes,width=${width},height=${height}`;
}
