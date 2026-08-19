/**
 * Pointer-based drag and drop.
 *
 * The scheduler used the HTML5 drag-and-drop API (`draggable="true"` +
 * dataTransfer). That API is mouse-only: on a touchscreen or a pen no
 * dragstart is ever generated, so every reorder in the app was simply dead
 * for anyone not holding a mouse — and the failure is silent, which is why an
 * automated mouse-driven suite kept passing over it.
 *
 * Pointer events cover mouse, touch and pen with one code path, so that is
 * what this does. Two Svelte actions:
 *
 *   use:draggable={{ data, label, handle }}
 *   use:dropzone={{ accepts, onOver, onLeave, onDrop }}
 *
 * Rules that make it behave like a real drag rather than a stray click:
 *  - a drag starts only after the pointer travels DRAG_THRESHOLD px, so a
 *    click on a card is still a click;
 *  - presses that land on a control (button, select, link, input) are left
 *    alone — dragging must not steal the row's own buttons;
 *  - TOUCH drags start only from a handle. A touch on the body of a row has
 *    to stay a scroll: hijacking it would trap the page, and the browser has
 *    usually begun panning before we could tell the difference.
 *  - the drop target is whatever `[data-droptarget]` sits under the pointer at
 *    release (innermost wins, like the old event bubbling), so a card inside a
 *    column behaves exactly as before.
 */

export interface DragData {
  /** What is being dragged ('todo', 'event', 'layer'…) — targets filter on it. */
  kind: string;
  id: string;
}

export interface DropZone {
  /** Which payloads this zone wants. Defaults to everything. */
  accepts?: (data: DragData) => boolean;
  /** Pointer moved over this zone (fires on every move — keep it cheap).
   * `node` is the zone's own element: the event is the window-level pointer
   * move, so its `currentTarget` is NOT the zone and cannot be measured. */
  onOver?: (data: DragData, event: PointerEvent, node: HTMLElement) => void;
  /** Pointer left this zone, or the drag ended elsewhere. */
  onLeave?: (data: DragData) => void;
  onDrop: (data: DragData, event: PointerEvent, node: HTMLElement) => void;
}

export interface DraggableOptions {
  data: DragData;
  /** Text shown in the drag ghost. */
  label?: string;
  /** CSS selector for the grab handle (required for touch). */
  handle?: string;
  disabled?: boolean;
  onStart?: (data: DragData) => void;
  onEnd?: (data: DragData) => void;
}

const DRAG_THRESHOLD = 5;
const CONTROL_SELECTOR = 'button, select, input, textarea, a[href], [contenteditable="true"]';

const zones = new Map<HTMLElement, DropZone>();

/** Registered drop target under a viewport point (innermost first). */
function zoneAt(x: number, y: number, data: DragData): { node: HTMLElement; zone: DropZone } | null {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el) {
    const node = el.closest('[data-droptarget]') as HTMLElement | null;
    if (!node) return null;
    const zone = zones.get(node);
    if (zone && (!zone.accepts || zone.accepts(data))) return { node, zone };
    // Registered but not interested — keep looking outwards.
    el = node.parentElement;
  }
  return null;
}

let ghost: HTMLElement | null = null;

function showGhost(label: string, x: number, y: number): void {
  ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = label;
  ghost.setAttribute('aria-hidden', 'true');
  document.body.append(ghost);
  moveGhost(x, y);
}

function moveGhost(x: number, y: number): void {
  if (ghost) ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
}

function removeGhost(): void {
  ghost?.remove();
  ghost = null;
}

export function draggable(node: HTMLElement, options: DraggableOptions) {
  let current = options;
  let startX = 0;
  let startY = 0;
  let pointerId: number | null = null;
  let dragging = false;
  let fromHandle = false;
  let suppressClick = false;
  let hovered: { node: HTMLElement; zone: DropZone } | null = null;

  function onClickCapture(event: MouseEvent) {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerDown(event: PointerEvent) {
    if (current.disabled || pointerId !== null) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    fromHandle = current.handle ? Boolean(target.closest(current.handle)) : false;
    // The row's own controls keep working; a handle press always drags. Only
    // controls INSIDE the node disqualify a press — a drag source that is
    // itself a button (a calendar entry) still has to be draggable.
    const control = target.closest(CONTROL_SELECTOR);
    if (!fromHandle && control && control !== node && node.contains(control)) return;
    // Touch: only the handle drags, so the list can still be scrolled.
    if (event.pointerType === 'touch' && !fromHandle) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown);
  }

  function onPointerMove(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    if (!dragging) {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      document.body.classList.add('dragging');
      showGhost(current.label ?? '', event.clientX, event.clientY);
      current.onStart?.(current.data);
    }
    // Stop the browser turning the gesture into a text selection or a pan.
    event.preventDefault();
    moveGhost(event.clientX, event.clientY);
    const next = zoneAt(event.clientX, event.clientY, current.data);
    if (hovered && hovered.node !== next?.node) hovered.zone.onLeave?.(current.data);
    hovered = next;
    if (next) next.zone.onOver?.(current.data, event, next.node);
  }

  function onPointerUp(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    const wasDragging = dragging;
    const target = hovered;
    finish();
    if (!wasDragging) return;
    // A drag that started on a clickable source (a calendar entry is a
    // button) still ends in a click event — which would open the thing the
    // user just moved. Swallow exactly one.
    suppressClick = true;
    target?.zone.onLeave?.(current.data);
    if (target) target.zone.onDrop(current.data, event, target.node);
  }

  function onCancel(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    hovered?.zone.onLeave?.(current.data);
    finish();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    hovered?.zone.onLeave?.(current.data);
    finish();
  }

  function finish() {
    if (dragging) current.onEnd?.(current.data);
    pointerId = null;
    dragging = false;
    hovered = null;
    document.body.classList.remove('dragging');
    removeGhost();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKeyDown);
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('click', onClickCapture, true);
  return {
    update(next: DraggableOptions) {
      current = next;
    },
    destroy() {
      finish();
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('click', onClickCapture, true);
    },
  };
}

export function dropzone(node: HTMLElement, zone: DropZone) {
  node.setAttribute('data-droptarget', '');
  zones.set(node, zone);
  return {
    update(next: DropZone) {
      zones.set(node, next);
    },
    destroy() {
      zones.delete(node);
      node.removeAttribute('data-droptarget');
    },
  };
}
