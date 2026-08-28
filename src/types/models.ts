/**
 * Trip Board — frozen data contract (M0).
 *
 * Every persisted entity lives in a single {@link Workspace} object which is
 * stored as one IndexedDB value. Ordering is explicit (`*Order` arrays of ids)
 * so drag & drop can reorder without touching the entities themselves.
 * Deletions are recorded as {@link Tombstone}s so a later sync milestone can
 * merge two workspaces without resurrecting removed rows.
 */

/** Opaque entity identifier (nanoid). */
export type Id = string;
/** Unix epoch milliseconds. */
export type Millis = number;

/** A trip: the top-level container for boards, sheets and timelines. */
export interface Trip {
  id: Id;
  title: string;
  /** ISO 4217-ish currency code used for budget display, e.g. `KRW`. */
  currency: string;
  /**
   * The currency spent on the ground, when it differs from {@link Trip.currency}
   * (M7b). Optional and additive — a trip saved before M7b simply has no field
   * and `schemaVersion` stays 1.
   */
  localCurrency?: string;
  /**
   * How many units of {@link Trip.currency} one unit of
   * {@link Trip.localCurrency} costs — `9.3` for `9.3 KRW per 1 JPY`.
   *
   * Used **only** to convert an amount as it is typed in; the stored
   * {@link CardExpense} is always in the trip's own currency, so changing the
   * rate later never rewrites a receipt that was already recorded.
   */
  fxRate?: number;
  /**
   * Where this trip happens — "일본 오사카" (M12).
   *
   * Purely a *view* hint: the 지도 tab opens over this point when the trip has
   * no located card yet, and the pin picker starts here instead of over Seoul.
   * Nothing is computed from it, so a stale destination costs a pan, not data.
   *
   * Optional and additive — a trip saved before M12 simply has no field and
   * `schemaVersion` stays 1. The LWW caveat that {@link Card.expenses} carries
   * does not apply: this is one scalar the trip owns, not a list two devices
   * can append to, so "the newest edit wins" is exactly the wanted behaviour.
   */
  destination?: GeoPoint;
  /** Ordered {@link BoardColumn} ids for the 보드 tab. */
  columnOrder: Id[];
  /** Ordered {@link Sheet} ids for the 일정 tab. */
  sheetOrder: Id[];
  createdAt: Millis;
  updatedAt: Millis;
}

/** One flight of a sheet's outbound/inbound pair. */
export interface FlightLeg {
  date: string /*YYYY-MM-DD*/;
  depTime: string /*HH:mm*/;
  arrTime: string;
  /** True when the flight lands on the day after {@link FlightLeg.date}. */
  arrNextDay?: boolean;
  flightNo?: string;
  from?: string;
  to?: string;
}

/**
 * 이 시트의 지도를 무엇으로 그리는가 (M41).
 *
 * 값이 하나뿐인 것은 의도적이다: **없음이 곧 OSM**이고, 그것이 M3부터의 동작이자
 * 백엔드 없는 GitHub Pages에서도 늘 되는 유일한 선택지다. `'osm'`이라는 값을
 * 따로 두면 「없음」과 「명시적 OSM」이라는, 화면에서 구분되지 않는 두 상태가
 * 생긴다.
 */
export type MapEngine = 'google';

/** A timesheet: an ordered run of days, optionally bracketed by flights. */
export interface Sheet {
  id: Id;
  tripId: Id;
  name: string;
  /** Ordered {@link Day} ids. */
  dayOrder: Id[];
  outboundFlight?: FlightLeg;
  inboundFlight?: FlightLeg;
  /**
   * 이 시트의 지도 엔진 (M41) — 없으면 OSM, `'google'`이면 구글 지도.
   *
   * 시트마다 고르는 이유는 이것이 **비교의 축**이기 때문이다. 시트 복제(M40)가
   * 시나리오를 나란히 놓으라고 만든 기능이고, 「같은 일정을 구글 지도 위에서
   * 보면 어떤가」도 그 비교의 하나다. 여행 단위로 걸면 두 시트가 같은 지도를
   * 쓸 수밖에 없고, 기기 단위로 걸면 두 사람이 서로 다른 화면을 본다.
   *
   * 이 값은 **그리는 방법**일 뿐 데이터가 아니다 — 카드의 좌표도, 배치도, 05시
   * 창도 엔진과 무관하게 똑같다. 그래서 키가 없는 기기(구글 키를 못 받은
   * GitHub Pages)에서는 이 필드가 붙은 시트도 조용히 OSM으로 그려진다. 지도가
   * 안 뜨는 것보다 다른 지도가 뜨는 편이 언제나 낫다.
   *
   * Optional and additive — M41 이전에 저장된 시트에는 필드가 없고
   * `schemaVersion`은 그대로 1이다.
   */
  mapEngine?: MapEngine;
  createdAt: Millis;
  updatedAt: Millis;
}

/** A kanban column on the brainstorm board. */
export interface BoardColumn {
  id: Id;
  tripId: Id;
  name: string;
  /** CSS color token / hex used for the column accent. */
  color: string;
  /** Emoji or icon key shown next to the column name. */
  icon: string;
  /** Ordered {@link Card} ids. */
  cardOrder: Id[];
  /**
   * 체크리스트 카테고리 (M29) — 환전·챙길 것·예약하기처럼 **장소가 없는** 일.
   *
   * 켜져 있으면 이 칸의 카드마다 보드에 체크박스가 서고, 일정 탭의 「할 일」
   * 시트가 그 카드들을 한 줄씩 모아 보여준다. 꺼져 있거나 **없으면** 평범한
   * 칸이다 — 즉 없음은 거짓쪽으로 읽힌다.
   *
   * 「없음」과 「명시적 false」를 굳이 가르는 이유는 M29의 자동 이행 때문이다:
   * 이름이 할일/할 일/todo인 **기존** 칸을 한 번만 체크리스트로 올려주는데,
   * 사람이 직접 끈 칸(false)까지 되살리면 그건 이행이 아니라 되돌리기다.
   * 그래서 규칙은 「플래그가 아예 없을 때만 손댄다」이고, 이 필드가 optional인
   * 것 자체가 그 규칙을 담는 그릇이다 (`todo/checklist.ts`).
   *
   * Optional and additive — M29 이전에 저장된 칸에는 필드가 없고
   * `schemaVersion`은 그대로 1이다.
   */
  todo?: boolean;
  /**
   * 이 칸의 카드 예산을 **시트마다 한 번만** 세는가 (M31).
   *
   * 필요 예산은 배치 단위로 센다 — 2만원짜리 식사 카드를 네 날에 걸어 두었으면
   * 밥은 네 번 먹고 돈은 네 번 나간다 (M25). 그런데 숙소는 정반대다: 4박짜리
   * 예약 하나를 네 칸에 걸어 두는 것은 「네 번 결제한다」가 아니라 「이 예약이
   * 나흘에 걸쳐 있다」는 뜻이고, 40만원을 160만원이라 말하면 그 바는 틀렸다.
   * 그래서 이 플래그가 켜진 칸의 카드는 배치를 몇 개 하든 시트 합계에 예산을
   * 한 번만 보태고, 그 한 번은 **가장 이른 배치가 그려지는 창**에 붙는다
   * (`utils/spend.ts`) — 일자 합계의 합이 시트 합계와 어긋나지 않게.
   *
   * {@link BoardColumn.todo}와 같은 삼항 규칙이다: 없으면 평범한 칸이고,
   * 「없음」과 「명시적 false」를 가르는 이유도 같다 — 이름이 숙소/호텔인 기존
   * 칸을 한 번만 자동으로 올려주는 이행이 사람이 직접 끈 칸을 되살리면 안 된다
   * (`board/budgetOnce.ts`).
   *
   * Optional and additive — M31 이전에 저장된 칸에는 필드가 없고
   * `schemaVersion`은 그대로 1이다.
   */
  budgetOnce?: boolean;
  createdAt: Millis;
  updatedAt: Millis;
}

/** A map coordinate, optionally with a human-readable address. */
export interface GeoPoint {
  lat: number;
  lng: number;
  address?: string;
}

/**
 * One amount actually spent on a card (M6).
 *
 * `budget` is what the card was *planned* to cost; these are the receipts.
 * They live on the card rather than on a timeline entry so the number survives
 * re-scheduling — and so a card placed twice never double-counts.
 */
export interface CardExpense {
  id: Id;
  /** In the trip's currency. Not rounded — some currencies have cents. */
  amount: number;
  /** What it was for; the UI falls back to '지출'. */
  label?: string;
  /** When it was recorded. */
  at: Millis;
  /**
   * Who paid / recorded it (M13) — a profile id, today `'song'` or `'hoyabom'`.
   *
   * A plain `string` on purpose: this layer must not depend on `profile/`, and
   * a receipt written by a profile a future build no longer knows about is
   * still a receipt. Optional and additive — an expense recorded before M13
   * has no field and `schemaVersion` stays 1; the UI simply shows no avatar.
   */
  by?: string;
}

/** A free-text note appended to a card, oldest first (M6). */
export interface CardComment {
  id: Id;
  text: string;
  at: Millis;
  /** Who wrote it (M13). Same shape and same caveats as {@link CardExpense.by}. */
  by?: string;
}

/**
 * One photo attached to a card (M10) — **metadata only**.
 *
 * The JPEG bytes deliberately live outside the workspace, in their own
 * idb-keyval store keyed by {@link CardPhoto.id} (see `stores/photoBlobs.ts`).
 * The workspace is re-serialized whole on every mutation, so a few megabytes of
 * pixels in here would be re-written every time a title is typed — and would
 * ride every sync push and every backup file.
 *
 * `w`/`h` are the stored (already downscaled) dimensions and `bytes` the
 * compressed size, so the UI can lay a thumbnail out and 설정 can total the
 * usage without touching IndexedDB.
 */
export interface CardPhoto {
  id: Id;
  /** Stored width in px. */
  w: number;
  /** Stored height in px. */
  h: number;
  /** Compressed JPEG size in bytes. */
  bytes: number;
  createdAt: Millis;
}

/** A brainstorm card: an idea that can be dragged onto the timeline. */
export interface Card {
  id: Id;
  tripId: Id;
  columnId: Id;
  title: string;
  memo?: string;
  url?: string;
  location?: GeoPoint;
  budget?: number;
  /** Default length in minutes used when the card is dropped on a day. */
  defaultDurationMin?: number;
  /**
   * Money actually spent on this card (M6). Optional and additive: a card
   * persisted before M6 simply has no field, and `schemaVersion` stays 1.
   * Sync merges the card as a whole, so the newest edit of *the card* wins the
   * whole list — two devices adding an expense at once keep only one list.
   */
  expenses?: CardExpense[];
  /** Comment thread on this card (M6), oldest first. Same LWW caveat. */
  comments?: CardComment[];
  /**
   * Photos attached to this card (M10), oldest first — metadata only, the
   * bytes live in their own IndexedDB store. Optional and additive: a card
   * saved before M10 has no field and `schemaVersion` stays 1. Same LWW caveat
   * as {@link Card.expenses} — sync merges the card whole.
   */
  photos?: CardPhoto[];
  /**
   * Who made this card (M13) — a profile id, today `'song'` or `'hoyabom'`.
   *
   * Written once, at creation, and never patched afterwards: it answers "누가
   * 올린 아이디어지?", not "who touched it last". A plain `string` for the same
   * reason {@link CardExpense.by} is one. Optional and additive — a card made
   * before M13 has no field and `schemaVersion` stays 1.
   */
  createdBy?: string;
  /**
   * 체크한 시각 (M29) — 불리언이 아니라 **타임스탬프**다.
   *
   * `true`와 달리 시각은 「방금 끝낸 것」의 순서를 공짜로 알려주므로, 할 일
   * 목록이 끝난 항목을 아래로 가라앉힐 때 무엇을 맨 위에 둘지 따로 저장할
   * 필요가 없다. 그러면서도 조건식에서는 그냥 참/거짓으로 읽힌다.
   *
   * 체크를 **풀면 필드가 사라진다** — `undefined`로 두는 것이 아니라
   * ({@link MemoMessage.removedAt}의 반대편에서) 키째로 없앤다. 그래야 동기화로
   * 건너가는 모양이 M29 이전 카드와 완전히 같아진다. 카드는 통째로 LWW로
   * 병합되므로 `sync/merge`는 손댈 것이 없다.
   *
   * 체크리스트 칸({@link BoardColumn.todo})이 아닌 칸의 카드에도 남아 있을 수
   * 있다 — 카드를 옮겨도 지우지 않는다. 보이지 않을 뿐이고, 되돌아오면 그대로
   * 체크된 채다.
   */
  doneAt?: Millis;
  createdAt: Millis;
  updatedAt: Millis;
}

/** A single day column inside a {@link Sheet}. */
export interface Day {
  id: Id;
  tripId: Id;
  sheetId: Id;
  /** `YYYY-MM-DD`; absent for unscheduled/relative days. */
  date?: string;
  label?: string;
  createdAt: Millis;
  updatedAt: Millis;
}

/** A card placed on a day at a given time. */
export interface TimelineEntry {
  id: Id;
  tripId: Id;
  cardId: Id;
  dayId: Id;
  /** Minutes from midnight. */
  startMin: number;
  durationMin: number;
  note?: string;
  createdAt: Millis;
  updatedAt: Millis;
}

/**
 * One line of the trip's 메모 thread (M21) — text, photos, or both.
 *
 * A top-level entity rather than a field on the trip, for the same reason cards
 * are: two people typing at once must not lose one of the two messages, and an
 * entity carrying its own `updatedAt` is exactly what `sync/merge` folds per id
 * instead of whole-list LWW.
 *
 * There is **no order array**. A chat is ordered by when it was said, so the
 * thread sorts by `createdAt` (then `id`, so ties never flap) — see
 * `src/memo/thread.ts`. That also means a message written offline lands in the
 * right place in the other person's thread the moment it syncs, rather than at
 * the end of an array whichever device happened to push last.
 */
export interface MemoMessage {
  id: Id;
  tripId: Id;
  text?: string;
  /** Same shape — and the same idb/blob split — as {@link Card.photos}. */
  photos?: CardPhoto[];
  /** Who wrote it. Same shape and same caveats as {@link CardExpense.by}. */
  by?: string;
  /**
   * Soft delete: when set, `text`/`photos` have **already been stripped** and
   * the UI renders a 삭제된 메시지 stub in place of the bubble.
   *
   * Deliberately not a {@link Tombstone}: `Tombstone['entity']` is a closed set
   * an older build looks up in a map, so a `'memo'` tombstone reaching a device
   * that predates this milestone would crash its merge. A soft delete is just
   * another edit and rides the ordinary entity LWW — and stripping the photo
   * ids here is what lets the existing GC (and the server delete behind it)
   * reclaim the bytes with no new machinery at all.
   */
  removedAt?: Millis;
  createdAt: Millis;
  updatedAt: Millis;
}

/** Record of a deletion, kept so sync/merge does not resurrect the entity. */
export interface Tombstone {
  id: Id;
  entity: 'trip' | 'sheet' | 'column' | 'card' | 'day' | 'entry';
  deletedAt: Millis;
}

/** The entire persisted state of the app. */
export interface Workspace {
  schemaVersion: 1;
  trips: Record<Id, Trip>;
  sheets: Record<Id, Sheet>;
  columns: Record<Id, BoardColumn>;
  cards: Record<Id, Card>;
  days: Record<Id, Day>;
  entries: Record<Id, TimelineEntry>;
  tombstones: Tombstone[];
  /**
   * When each profile last opened the app (M13) — profile id → epoch ms.
   *
   * The one piece of *device* news that is deliberately kept **inside** the
   * workspace: the whole point is for the other person to see it, and the only
   * thing that travels between the two devices is this blob.
   *
   * It is not an entity and carries no `updatedAt`, so it cannot ride the
   * entity LWW in `sync/merge`: two devices each stamping their own key would
   * lose one of the keys. `merge` folds it **per key, newest wins** instead.
   *
   * Optional and additive — a workspace saved before M13 has no field,
   * {@link emptyWorkspace} still does not create one, and `schemaVersion`
   * stays 1.
   */
  seenBy?: Record<string, Millis>;
  /**
   * The 메모 threads of every trip (M21), keyed by message id.
   *
   * One flat map rather than one per trip: it merges like every other entity
   * map, and each message carries its own `tripId`. Optional and additive — a
   * workspace saved before M21 has no field, {@link emptyWorkspace} still does
   * not create one (same reasoning as {@link Workspace.seenBy}), and
   * `schemaVersion` stays 1.
   */
  memos?: Record<Id, MemoMessage>;
}

/** A fresh, empty workspace. */
export const emptyWorkspace = (): Workspace => ({
  schemaVersion: 1,
  trips: {},
  sheets: {},
  columns: {},
  cards: {},
  days: {},
  entries: {},
  tombstones: [],
});
