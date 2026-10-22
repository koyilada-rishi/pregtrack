// Shared UI: bottom sheets + 6-second undo toasts.
//
// Both are appended to document.body (not the router outlet) so they work
// identically whether opened from Home, the Meds page, or anywhere else,
// and survive a route change underneath them (closed explicitly on
// navigation — see attachNavButtons/renderRoute in the view that opened
// them). Only one of each at a time; opening a new one replaces whatever's
// already showing.
//
// The undo pattern used everywhere a delete/stop happens: apply the change
// to local state and re-render immediately (optimistic), show a toast with
// Undo, and only fire the real network call once the toast's 6s expire
// without Undo being pressed. Pressing Undo this restores local state and
// never touches the network at all — there's nothing to roll back server-
// side because nothing was ever sent. This is what "no scary confirm
// dialogs" means in practice: the action already happened, reversibly.

import { t } from "../core/i18n.js";
import { escapeHtml } from "./format.js";

export function closeSheet() {
  const el = document.getElementById("active-sheet-overlay");
  if (el) el.remove();
}

// innerHtml is the sheet's own content (its own heading + body + actions);
// onMount(sheetEl) runs right after it's in the DOM, for attaching handlers.
export function openSheet(innerHtml, onMount) {
  closeSheet();
  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.id = "active-sheet-overlay";
  overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${innerHtml}</div>`;
  overlay.addEventListener("click", (event) => { if (event.target === overlay) closeSheet(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("sheet-open"));
  if (onMount) onMount(overlay.querySelector(".sheet"));
  return overlay;
}

let undoToastTimeoutId = null;
// The commit for whichever toast is currently pending — set whenever one is
// showing, cleared once it's resolved one way or another (committed,
// undone, or superseded). closeUndoToast() needs this: "opening a new one
// replaces whatever's already showing" (see comment above) must still
// finalize the replaced action, or replacing it would silently cancel a
// delete that already happened in the UI — exactly the kind of local/
// backend drift this pattern exists to avoid, not cause.
let pendingUndoCommit = null;

export function closeUndoToast() {
  if (undoToastTimeoutId) { clearTimeout(undoToastTimeoutId); undoToastTimeoutId = null; }
  const el = document.getElementById("active-undo-toast");
  if (el) el.remove();
  if (pendingUndoCommit) {
    const commit = pendingUndoCommit;
    pendingUndoCommit = null;
    commit();
  }
}

// message: shown plain text. onUndo(): called if the person taps Undo
// within the window — nothing else happens. onCommit(): called once the
// toast expires untouched (or gets superseded by another one — see
// closeUndoToast above) — this is where the real store.call() actually
// fires.
export function showUndoToast(message, { onUndo, onCommit }, seconds) {
  closeUndoToast();
  pendingUndoCommit = onCommit;
  const toast = document.createElement("div");
  toast.className = "undo-toast";
  toast.id = "active-undo-toast";
  toast.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" class="btn-link undo-toast-btn">${t("common.undo")}</button>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("undo-toast-open"));

  undoToastTimeoutId = setTimeout(async () => {
    undoToastTimeoutId = null;
    pendingUndoCommit = null;
    toast.remove();
    await onCommit();
  }, (seconds || 6) * 1000);

  toast.querySelector(".undo-toast-btn").addEventListener("click", () => {
    if (undoToastTimeoutId) { clearTimeout(undoToastTimeoutId); undoToastTimeoutId = null; }
    pendingUndoCommit = null;
    toast.remove();
    onUndo();
  });
}
