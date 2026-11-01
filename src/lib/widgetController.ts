import { api, isTauri, subscribe } from '@/api';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';

let pendingOpen = false;
let activeOpen: (() => void) | null = null;
function consume() {
  if (pendingOpen && activeOpen) { pendingOpen = false; activeOpen(); }
}

/** Subscribe before draining, so a URL received during webview boot is not lost. */
export function installWidgetController(): () => void {
  if (!isTauri()) return () => {};
  const open = () => {
    useUiStore.getState().closeAllOverlays();
    useTimerStore.getState().openScreen(true);
  };
  activeOpen = open;
  const drain = () => {
    void api.take_widget_launch().then(requested => {
      if (requested) pendingOpen = true;
      consume();
    }).catch(error => console.warn('Widget launch failed', error));
  };
  const off = subscribe('widget://open', drain);
  consume();
  drain();
  // An in-flight response belongs to the next mounted controller, not a stale one.
  return () => { if (activeOpen === open) activeOpen = null; off(); };
}
