/**
 * The shared download / copy pipeline (plan dependency note: built once by
 * the first phase to need it — Phase 4's QR export — and reused by the image
 * tools in Phases 5–7).
 *
 * Conventions: downloads carry an explicit filename; clipboard images are
 * always PNG (the only image type the async clipboard API reliably accepts);
 * copy helpers resolve false instead of throwing so callers can show a
 * graceful "couldn't copy" state.
 */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    // Give the click a tick before revoking, or the download can abort.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  downloadBlob(dataUrlToBlob(dataUrl), filename);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',', 2);
  const mime = head?.match(/^data:([^;]+)/)?.[1] ?? 'application/octet-stream';
  if (head?.includes(';base64')) {
    const bytes = atob(body ?? '');
    const buf = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }
  return new Blob([decodeURIComponent(body ?? '')], { type: mime });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copy a PNG blob to the clipboard (labeled PNG by convention). */
export async function copyPng(blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
