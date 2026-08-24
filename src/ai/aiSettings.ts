/**
 * The AI 도우미 switch, and the little bit of state the ✨ buttons read (M11).
 *
 * Three things have to be true before a single AI control is allowed to appear:
 *
 *   1. the user turned the toggle on          — {@link AiState.enabled}, here
 *   2. sync is configured                     — `sync/settings.isConfigured`
 *   3. the server actually holds a Gemini key — {@link AiState.available},
 *      set by `ai/aiClient.refreshAiCapability`
 *
 * The first lives in `localStorage` for exactly the reasons the sync settings
 * do: it is **per-device**, it must never travel to the server and back, and
 * the app has to keep working where `localStorage` does not exist at all. The
 * other two are session state and are deliberately not persisted — a stale
 * "the server has a key" cached from last week is worse than one ping.
 */

import { create } from 'zustand';
import { isConfigured } from '../sync/settings';

const AI_KEY = 'trip-board/ai';

/** What the toggle remembers between reloads. */
export interface AiSettings {
  enabled: boolean;
}

/** Off. Every build that has never been told otherwise starts here. */
export const DEFAULT_AI_SETTINGS: AiSettings = { enabled: false };

/** `localStorage`, or `null` where it is missing or blocked (Node, private mode). */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * True when the toggle has ever been saved on this device — lets the M14
 * bootstrap distinguish "never touched" (may default on) from an explicit
 * OFF (must be respected forever).
 */
export function hasStoredAiSettings(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(AI_KEY) != null;
  } catch {
    return false;
  }
}

/** Reads the stored toggle, falling back to off for anything unexpected. */
export function loadAiSettings(): AiSettings {
  const store = storage();
  if (!store) return { ...DEFAULT_AI_SETTINGS };
  try {
    const raw = store.getItem(AI_KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AiSettings> | null;
    return { enabled: parsed?.enabled === true };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

/** Persists the toggle. Failing to write is never fatal — it is a preference. */
export function saveAiSettings(settings: AiSettings): AiSettings {
  const store = storage();
  const next: AiSettings = { enabled: settings.enabled === true };
  if (!store) return next;
  try {
    store.setItem(AI_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

/**
 * The two flags every ✨ button watches.
 *
 * A store rather than a module variable because the buttons live in four
 * different subtrees (보드 헤더, 일정 헤더, 상단 바, 설정 시트) and all four have
 * to notice the moment the toggle flips or the ping comes back.
 */
export interface AiState {
  /** The user's switch. Persisted. */
  enabled: boolean;
  /** Did the last ping find a key on the server? Session-only. */
  available: boolean;
  /** Has a ping finished at least once this session? Drives the status line. */
  checked: boolean;
  setEnabled: (enabled: boolean) => void;
  setAvailable: (available: boolean) => void;
}

export const useAiStore = create<AiState>()((set) => ({
  enabled: loadAiSettings().enabled,
  available: false,
  checked: false,
  setEnabled: (enabled) => {
    saveAiSettings({ enabled });
    set({ enabled });
  },
  setAvailable: (available) => set({ available, checked: true }),
}));

/**
 * All three conditions, as a hook — the form every component wants.
 *
 * `isConfigured()` is read rather than subscribed to, which is safe because
 * every path that changes it (저장 / 해제 in the settings sheet) also kicks a
 * `refreshAiCapability`, and *that* writes `available` and re-renders us.
 */
export function useAiEnabled(): boolean {
  const enabled = useAiStore((s) => s.enabled);
  const available = useAiStore((s) => s.available);
  return enabled && available && isConfigured();
}
