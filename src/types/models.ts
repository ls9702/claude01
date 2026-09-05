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
  /**
   * 이 여행의 드로우 페이지 순서 (M52a) — {@link DrawPage} ids.
   *
   * `columnOrder`·`sheetOrder`와 같은 자리에 있으면서 optional인 이유는 하나다:
   * M52a 이전에 저장된 여행에는 이 키가 없어야 하고, 드로우를 한 번도 열지
   * 않은 여행에는 앞으로도 없어야 한다(`sync/merge`가 빈 배열을 만들어 내지
   * 않는다 — 만들면 모든 기기가 한 번씩 쓸데없는 푸시를 한다).
   *
   * 페이지 자신은 {@link Workspace.drawPages}에 여행과 무관하게 평평히 눕고,
   * 이 배열은 **순서만** 말한다 — {@link Workspace.memos}가 순서 배열을 갖지
   * 않는 것과 정반대인데, 이유도 정반대다: 대화는 말한 시각이 곧 순서이지만
   * 스케치북의 페이지 순서는 사람이 정한다.
   *
   * Optional and additive — `schemaVersion`은 그대로 1이다.
   */
  drawPageOrder?: Id[];
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
  /**
   * 우리 부부가 직접 고른 **맛집 칸**인가 (M49).
   *
   * M43의 「주변 맛집」은 남이 추천해 준 곳이다 — 큐레이션 조사와 구글 평점이
   * 고른 참고 자료. 이 플래그가 켜진 칸은 그 반대편이다: **우리가 가기로 한
   * 집들**이고, 그래서 데이터가 워크스페이스 안에 산다(레이어가 아니라 카드다).
   *
   * 켜져 있으면 두 가지가 달라진다. 카드 편집 시트에 장르 픽커 한 줄이 서고
   * ({@link Card.gourmetGenre}), 지도의 ⭐ 레이어가 이 칸의 **위치 있는 카드
   * 전부**를 장르 이모지 핀으로 올린다(배치 여부와 무관 — 아직 어느 날에도
   * 넣지 않은 후보야말로 지도에서 봐야 하는 것이다).
   *
   * {@link BoardColumn.todo}·{@link BoardColumn.budgetOnce}와 **같은 삼항
   * 규칙**이다: 없으면 평범한 칸이고, 「없음」과 「명시적 false」를 가르는 이유도
   * 같다 — 이름이 「맛집」인 기존 칸을 한 번만 올려 주는 이행이 사람이 직접 끈
   * 칸을 되살리면 안 된다 (`board/gourmetColumn.ts`).
   *
   * Optional and additive — M49 이전에 저장된 칸에는 필드가 없고
   * `schemaVersion`은 그대로 1이다.
   */
  gourmet?: boolean;
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
  /**
   * 이 맛집 카드의 장르 (M49) — `'sushi'`·`'cafe'`처럼 여덟 갈래 중 하나.
   *
   * 유니온이 아니라 **평범한 `string`**이다. {@link CardExpense.by}가 프로필
   * id를 그렇게 들고 있는 것과 같은 이유다: 이 계층은 `gourmet/`를 몰라야 하고,
   * 나중에 갈래가 하나 늘거나 줄어도 저장된 카드는 여전히 유효한 카드여야
   * 한다. 모르는 값은 화면에서 「장르 없음」처럼 다뤄질 뿐 데이터가 깨지지
   * 않는다 (`gourmet/userGenres.ts`의 `isUserGourmetGenre`).
   *
   * 맛집 칸({@link BoardColumn.gourmet})이 **아닌** 칸의 카드에도 남아 있을 수
   * 있다 — 카드를 옮겼다고 지우지 않는다({@link Card.doneAt}와 같은 결정).
   * 보이지 않을 뿐이고, 되돌아오면 그대로다.
   *
   * 칩을 다시 눌러 해제하면 다른 선택 필드들과 **같은 길**로 비워진다:
   * `CardPatch`에 `undefined`가 실리고(`location`·`budget`이 이미 그렇다), 저장·
   * 동기화되는 JSON에는 키가 남지 않아 M49 이전 카드와 같은 모양이 된다.
   *
   * Optional and additive — M49 이전에 저장된 카드에는 필드가 없고
   * `schemaVersion`은 그대로 1이다.
   */
  gourmetGenre?: string;
  /**
   * 이 카드에 붙은 드로우 페이지 (M52b) — {@link DrawPage.id} 하나.
   *
   * 방향이 **카드 → 페이지**인 이유는 카드가 하나를 가리키고 페이지는 여럿에게
   * 가리켜지기 때문이다: 페이지 쪽에 `cardIds: Id[]`를 두면 같은 사실이 두 곳에
   * 적히고, 그 둘이 다른 말을 하는 날이 온다(카드를 지웠을 때·병합이 갈렸을 때).
   * 페이지 편집기의 「연결된 카드 N」은 이 필드를 거꾸로 훑어 만든다 — 값은
   * 하나뿐이고, 세는 것은 화면의 일이다.
   *
   * **없는 페이지를 가리켜도 그대로 둔다.** 페이지를 지우면 카드의 🎨 칩은
   * 조용히 사라지지만 필드는 남는다 — 삭제 실행취소(10초)가 페이지를 되살리면
   * 연결도 함께 돌아와야 하고, 「지웠으니 카드도 고쳐 쓰자」는 병합이 갈린
   * 기기에서 그 카드를 통째로 덮는 편집이 된다.
   *
   * Optional and additive — M52b 이전 카드에는 필드가 없고 `schemaVersion`은
   * 그대로 1이다. 카드는 통째로 LWW로 병합되므로 `sync/merge`는 손댈 것이 없다.
   */
  drawPageId?: Id;
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

/* ------------------------------------------------------------------ *
 * 드로우 (M52a)
 * ------------------------------------------------------------------ */

/**
 * 한 요소가 공통으로 드는 것 — id와 시각, 그리고 지운 시각.
 *
 * `deletedAt`이 {@link Tombstone}이 아닌 이유는 {@link MemoMessage.removedAt}이
 * 그런 이유와 **정확히 같다**: `Tombstone['entity']`는 모든 빌드가 표에서 찾는
 * 닫힌 집합이라, M52a를 모르는 기기에 `'drawElement'` 톰스톤이 닿으면 그 표를
 * `undefined`로 색인하고 다음 줄에서 죽는다. 요소의 삭제는 그냥 「지운 시각이
 * 찍힌 편집」이고, 그래서 평범한 요소 단위 LWW가 삭제까지 실어 나른다.
 *
 * 요소에 `createdAt`이 없는 것도 의도다. 요소의 나이가 궁금한 자리는 하나뿐인데
 * ({@link DrawPage.elementOrder}에 빠진 요소를 어디에 붙이나) 그 자리에서는
 * `updatedAt`이 같은 답을 주고, 획 하나마다 필드를 하나 더 얹으면 그것이 곧
 * 워크스페이스 크기다 — 이 모델에서 개수가 천 단위로 늘 수 있는 유일한 것이
 * 요소다.
 */
export interface DrawElementBase {
  id: Id;
  updatedAt: Millis;
  /** 지운 시각. 있으면 화면에도 병합에도 없는 것으로 친다. */
  deletedAt?: Millis;
  /**
   * 잠긴 요소 (M53-2) — 보이지만 **손에 잡히지 않는다**.
   *
   * 큰 사진을 종이처럼 깔고 그 위에 낙서할 때를 위한 것이다: 잠그지 않으면 획을
   * 그으려던 손이 사진을 끌고 다닌다. 잠긴 것은 맞힘·이동·리사이즈·삭제·마퀴에서
   * 전부 빠지고, 푸는 길은 둘이다 — 컴퓨터에서는 **Shift+클릭**, 폰에서는 그것을
   * **탭했을 때 뜨는 한 줄**(M53-fix ②).
   *
   * `additive optional`이라 이 필드를 모르는 옛 빌드에서는 그냥 안 잠긴 요소다 —
   * 잠금은 데이터의 성질이 아니라 편집의 편의이므로 그 결말이 안전하다.
   */
  locked?: boolean;
}

/**
 * 손그림 한 획 (M52a).
 *
 * `points`가 `{x,y}[]`가 아니라 **평탄한 정수 배열**(`[x0,y0,x1,y1,…]`)인 이유는
 * 저장 크기다: 같은 200점이 객체 배열로는 3KB가 넘고 이 모양으로는 1KB 아래다.
 * 그 위에 `draw/simplify.ts`가 RDP 단순화와 정수 양자화를 한 번 걸어 점 수
 * 자체를 줄인다 — 손가락은 1px 떨림을 그리지만 사람은 그것을 보지 않는다.
 */
export interface DrawStroke extends DrawElementBase {
  type: 'stroke';
  /** `[x0, y0, x1, y1, …]` — 페이지 로컬 CSS px, 정수. */
  points: number[];
  color: string;
  width: number;
  /** 형광펜은 반투명하고 굵다 — 색이 아니라 성질이라 필드로 둔다. */
  kind: 'pen' | 'highlight';
}

/** 사각형·타원 — 왼쪽 위 모서리와 크기. `w`/`h`는 항상 양수로 정규화된다. */
export interface DrawBox extends DrawElementBase {
  type: 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  width: number;
  /** 채움 색. 없으면 테두리만 그린다. */
  fill?: string;
  /** 테두리를 점선으로 (M53-2). 없으면 실선. */
  dash?: boolean;
}

/** 직선·화살표 — 두 끝점. 화살표는 끝점에 머리가 붙는다. */
export interface DrawSegment extends DrawElementBase {
  type: 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  /** 점선으로 (M53-2) — 「아직 정하지 않은 동선」. */
  dash?: boolean;
  /**
   * 화살촉이 붙는 자리 (M53-2) — 없으면 `'end'`(끝점 하나).
   *
   * `'both'`는 「가는 길과 오는 길」이다. `line`에는 뜻이 없다(촉이 없다) —
   * 필드가 유니온 하나에 함께 사는 것은 두 타입이 좌표를 공유하기 때문이다.
   */
  heads?: 'end' | 'both';
}

/** 탭한 자리에 앉는 글자 한 줄. */
export interface DrawText extends DrawElementBase {
  type: 'text';
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
}

/** 이모지 스티커 — 관광지 사진 위에 「여기!」를 붙이는 물건. */
export interface DrawSticker extends DrawElementBase {
  type: 'sticker';
  x: number;
  y: number;
  emoji: string;
  size: number;
}

/**
 * 페이지 위에 붙인 사진 한 장 (M53-2).
 *
 * 배경({@link DrawPage.background})과 **다른 물건**이다: 배경은 페이지의 껍데기라
 * 한 장뿐이고 자리를 옮길 수 없는 「종이」이고, 이것은 옮기고 키우고 겹치고
 * 복사되는 평범한 요소다. 그래서 여러 장을 나란히 놓거나 낙서 밑에 깔거나 위에
 * 얹을 수 있다.
 *
 * 바이트는 여기 없다 — 배경·카드 사진과 **완전히 같은 길**로 들어온다
 * (`utils/photos.preparePhoto` → `stores/photoBlobs` → `sync/photoSync`). 요소가
 * 드는 것은 {@link photoId} 하나뿐이라 워크스페이스 JSON은 요소당 100바이트도
 * 늘지 않는다. 그 대신 **GC가 이 요소를 알아야 한다**
 * (`utils/photos.referencedPhotoIds`) — 모르면 30초 뒤에 사진이 사라진다.
 */
export interface DrawImage extends DrawElementBase {
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** {@link CardPhoto.id}와 같은 자리의 id — 바이트는 idb + `image.php`에 있다. */
  photoId: Id;
  /** 0.2~1. 없으면 1 (`tools.clampOpacity`와 같은 문). */
  opacity?: number;
}

/**
 * 드로우 페이지 위의 한 요소 (M52a) — `type`으로 갈리는 판별 유니온.
 *
 * 판별자가 획의 `kind`가 아니라 `type`인 이유는 둘이 서로 다른 질문에 답하기
 * 때문이다: `type`은 「무엇으로 그렸나」이고 `kind`는 획 하나 안에서 「펜인가
 * 형광펜인가」다.
 */
export type DrawElement =
  | DrawStroke
  | DrawBox
  | DrawSegment
  | DrawText
  | DrawSticker
  | DrawImage;

/** {@link DrawElement}의 판별자 — 도구 하나가 곧 하나씩이다. */
export type DrawElementType = DrawElement['type'];

/**
 * 한 장의 드로우 페이지 (M52a).
 *
 * 카드·시트와 달리 **요소를 자기 안에 담는다**. 요소를 워크스페이스 최상위 맵에
 * 올리지 않은 이유는 하나뿐이다: 요소는 개수가 천 단위로 자라는 유일한 것이고,
 * 페이지를 지우면 그 전부가 함께 사라져야 하는데 최상위에 있으면 그 「전부」를
 * 톰스톤으로 일일이 말해야 한다. 페이지 안에 있으면 페이지 하나의
 * {@link DrawPage.deletedAt} 한 줄이 그 말을 다 한다.
 *
 * 그 대신 병합은 두 겹이다(`sync/merge.ts`): 페이지의 **껍데기**(제목·배경·
 * 순서)는 평범한 엔티티 LWW로 갈리고, `elements`는 **요소 단위 LWW**로 합쳐진다.
 * 두 사람이 같은 페이지에 동시에 그리면 두 그림이 다 남아야 하기 때문이다 —
 * 페이지를 통째로 LWW하면 늦게 저장한 쪽이 상대의 획을 지운다.
 */
export interface DrawPage {
  id: Id;
  tripId: Id;
  title: string;
  createdAt: Millis;
  updatedAt: Millis;
  /** 지운 시각 — {@link DrawElementBase.deletedAt}과 같은 이유로 톰스톤이 아니다. */
  deletedAt?: Millis;
  /**
   * 배경으로 깔린 사진 (M52b에서 UI가 붙는다).
   *
   * 바이트가 아니라 {@link CardPhoto.id}를 든다 — 사진은 이미 워크스페이스 밖
   * (idb + `image.php`)에 살고, 그 규칙을 드로우가 다시 발명할 이유가 없다.
   */
  background?: {
    photoId: Id;
    /** 0~1. 없으면 렌더러의 기본값. */
    opacity?: number;
  };
  /**
   * 종이 무늬 (M53-2) — 없으면 `'plain'`(무지).
   *
   * 제목·배경과 **같은 층**의 껍데기 필드라 평범한 엔티티 LWW로 갈린다. 격자와
   * 점은 그림이 아니라 종이라서 요소로 두지 않았다: 요소였다면 지우개에 지워지고
   * 마퀴에 잡히고 PNG의 경계 계산에 끼어든다.
   */
  paper?: 'plain' | 'grid' | 'dot';
  elements: Record<Id, DrawElement>;
  /** 그리는 순서 = 겹치는 순서. 뒤에 있는 것이 위에 그려진다. */
  elementOrder: Id[];
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
  /**
   * 모든 여행의 드로우 페이지 (M52a), 페이지 id로 키를 잡는다.
   *
   * {@link Workspace.memos}와 같은 모양이고 같은 이유다: 여행마다 하나씩 두는
   * 대신 평평한 맵 하나이고, 페이지가 자기 `tripId`를 든다. 순서는 여행 쪽
   * ({@link Trip.drawPageOrder})이 든다.
   *
   * Optional and additive — M52a 이전에 저장된 워크스페이스에는 필드가 없고,
   * {@link emptyWorkspace}도 만들지 않으며, `schemaVersion`은 그대로 1이다.
   */
  drawPages?: Record<Id, DrawPage>;
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
