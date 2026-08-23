/**
 * Category color system for board columns.
 *
 * A column stores only a token (`'sky'`, `'amber'`, …); every Tailwind class is
 * written out **statically** here so the Tailwind v4 scanner can see it. Never
 * build a class with a template literal (`bg-${color}-100`) — it would be
 * dropped from the generated stylesheet.
 */

export const COLOR_TOKENS = [
  'sky',
  'violet',
  'amber',
  'rose',
  'emerald',
  'teal',
  'orange',
  'slate',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

/**
 * Each slot has **exactly one** job (M9 §2.1). The class strings never change —
 * the Tailwind scanner needs them written out — but where they may be used is
 * now fixed, because one token doing two jobs at two intensities is what made
 * the palette unreadable.
 */
export interface ColorClasses {
  /** Korean name shown in the color picker. */
  label: string;
  /**
   * The **map legend only**. Card chips are neutral now: a card's left accent
   * bar already names its category, and colouring the chips too meant 예산 and
   * 지출 were the same colour on the same card.
   */
  chip: string;
  /** Left accent bar — board card (3px) and timeline entry (3px). */
  accent: string;
  /** Column header background + text. Headers, and nothing else. */
  header: string;
  /** Timeline entry block background (the column body is neutral canvas). */
  surface: string;
  /** Solid dot used in the picker and next to the column name. */
  dot: string;
}

/** Fixed palette — token → static Tailwind class strings. */
export const COLORS: Record<ColorToken, ColorClasses> = {
  sky: {
    label: '하늘',
    chip: 'bg-sky-100 text-sky-700',
    accent: 'border-l-sky-400',
    header: 'bg-sky-50 text-sky-900',
    surface: 'bg-sky-50/60',
    dot: 'bg-sky-400',
  },
  violet: {
    label: '보라',
    chip: 'bg-violet-100 text-violet-700',
    accent: 'border-l-violet-400',
    header: 'bg-violet-50 text-violet-900',
    surface: 'bg-violet-50/60',
    dot: 'bg-violet-400',
  },
  amber: {
    label: '노랑',
    chip: 'bg-amber-100 text-amber-700',
    accent: 'border-l-amber-400',
    header: 'bg-amber-50 text-amber-900',
    surface: 'bg-amber-50/60',
    dot: 'bg-amber-400',
  },
  rose: {
    label: '분홍',
    chip: 'bg-rose-100 text-rose-700',
    accent: 'border-l-rose-400',
    header: 'bg-rose-50 text-rose-900',
    surface: 'bg-rose-50/60',
    dot: 'bg-rose-400',
  },
  emerald: {
    label: '초록',
    chip: 'bg-emerald-100 text-emerald-700',
    accent: 'border-l-emerald-400',
    header: 'bg-emerald-50 text-emerald-900',
    surface: 'bg-emerald-50/60',
    dot: 'bg-emerald-400',
  },
  teal: {
    label: '청록',
    chip: 'bg-teal-100 text-teal-700',
    accent: 'border-l-teal-400',
    header: 'bg-teal-50 text-teal-900',
    surface: 'bg-teal-50/60',
    dot: 'bg-teal-400',
  },
  orange: {
    label: '주황',
    chip: 'bg-orange-100 text-orange-700',
    accent: 'border-l-orange-400',
    header: 'bg-orange-50 text-orange-900',
    surface: 'bg-orange-50/60',
    dot: 'bg-orange-400',
  },
  slate: {
    label: '회색',
    chip: 'bg-slate-100 text-slate-700',
    accent: 'border-l-slate-400',
    header: 'bg-slate-50 text-slate-900',
    surface: 'bg-slate-50/60',
    dot: 'bg-slate-400',
  },
};

/**
 * Same palette as literal hex, for the places Tailwind cannot reach.
 *
 * **Map pins only.** Leaflet builds its `DivIcon` markers from an HTML string
 * that never goes through the Tailwind scanner, so the pins are styled inline
 * from this map. Route lines used to cycle through it too; they are one ink
 * colour now, so a day-2 route can never be mistaken for the 할일 category. The values mirror Tailwind's `*-500` shade — one step darker
 * than {@link ColorClasses.dot} so a white-bordered pin stays readable on top
 * of map tiles.
 */
export const COLOR_HEX: Record<ColorToken, string> = {
  sky: '#0ea5e9',
  violet: '#8b5cf6',
  amber: '#f59e0b',
  rose: '#f43f5e',
  emerald: '#10b981',
  teal: '#14b8a6',
  orange: '#f97316',
  slate: '#64748b',
};

/** Fallback used when a column carries an unknown color token. */
export const DEFAULT_COLOR: ColorToken = 'slate';

export const isColorToken = (value: string): value is ColorToken =>
  (COLOR_TOKENS as readonly string[]).includes(value);

/** Class bundle for any stored color string; unknown tokens fall back to slate. */
export const colorClasses = (color: string): ColorClasses =>
  COLORS[isColorToken(color) ? color : DEFAULT_COLOR];

/** Hex for any stored color string; unknown tokens fall back to slate. */
export const colorHex = (color: string): string =>
  COLOR_HEX[isColorToken(color) ? color : DEFAULT_COLOR];
