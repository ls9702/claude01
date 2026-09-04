# Trip Board — 세션 핸드오프 문서

> 다음 세션의 Claude에게: 새 작업을 시작하기 전에 이 문서를 끝까지 읽으세요.
> 이 문서 + `README.md` + `docs/deploy-synology.md`가 프로젝트의 전부를 설명합니다.

## 1. 프로젝트 한 줄 요약

2인(songlee=S, hoyabom=HB) 전용 여행 계획 PWA. 브레인스토밍 칸반 보드 → 일자별 타임시트(05시 경계) 드래그 배치 → 지도 동선 → 지출/결산 → Gemini AI 도우미. 시놀로지 NAS 자가호스팅 + 자동 동기화.

## 2. 운영 현황 (2026-08-24 기준, 실사용 중)

| 항목 | 값 |
|---|---|
| **공식 주소** | `https://trip.863ad.co.kr` (Let's Encrypt, 가비아 DNS CNAME → `ls9702.synology.me`) |
| 보조 주소 | `https://ls9702.synology.me:8443` (구주소, 병행 동작), GitHub Pages `https://ls9702.github.io/claude01/` (백엔드 없음) |
| NAS 배치 | Web Station 이름기반 가상호스트 443 → `web/travel/` (PHP 7.4 프로필, **curl 확장 필수**) |
| 서버 파일 | `web/travel/api/{data,ai,image,admin,archive}.php` + `config.php`(SYNC_TOKEN·**ADMIN_TOKEN**·GEMINI_API_KEY·DATA_DIR·**ARCHIVE_DIR** — **git에 없음, NAS에만**) |
| 자동 설정 | `web/travel/bootstrap-config.json`(주소+토큰, **git에 없음**) — 새 기기 무설정 연결, 주소 변경 시 자동 이행 |
| 데이터 | **M46부터 세션별**: `api/data/active.json`(`{"active":"<id>"}`) + `api/data/sessions/<id>/{data.json, data.backup.0~4.json, daily/workspace-YYYYMMDD.json(30일, M30), photos/<id>.jpg, session.json(표시명·archived), profiles.json}`. 그 밖에 `api/data/{notice.json, archive-settings.json}`. **업그레이드 후 첫 요청이 옛 `data.json`·`photos/`를 `sessions/default/`로 한 번 옮긴다**(rename, 멱등) |
| 사진 보관함 | `ARCHIVE_DIR/<관리자가 정한 폴더>/<원본명>` — 계획과 무관, 압축·리사이즈 없음 (M46) |
| 공유기 | ASUS TUF-AX5400, 정적 포워딩 80/443→192.168.50.2 (5000/5001 DSM용) |
| 배포 방법 | dist/ 빌드 결과 + (서버 변경 시) api/*.php를 `web/travel/`에 **덮어쓰기**. config.php·data/·bootstrap-config.json은 건드리지 않음. GitHub Pages는 브랜치 push 시 deploy.yml이 자동 처리 |
| **M46/M47 배포 시 추가 작업** | ①`api/data.php`·`api/image.php` **교체** ②`api/admin.php`·`api/archive.php` **신규 업로드** ③`api/config.php`에 `'ADMIN_TOKEN' => '<긴 랜덤 문자열>'`과 `'ARCHIVE_DIR' => '/volume1/photo/trip-board'`(예시) **두 줄 추가** ④ARCHIVE_DIR 폴더를 만들고 web 사용자에게 쓰기 권한 부여. data/ 이행은 자동 — 손댈 것 없음 |

## 3. 기술 스택 / 저장소 구조

Vite 7 · React 19 · TS · Tailwind 4(CSS-first `@theme`) · zustand 5 · dnd-kit · Leaflet+OSM · idb-keyval · vite-plugin-pwa. 백엔드는 순수 PHP 3파일(프레임워크·DB·Docker 없음).

```
src/
  types/models.ts        ← 데이터 계약 (schemaVersion 1 고정, 추가는 optional 필드만!)
  stores/                ← workspaceStore(모든 뮤테이션, run() 패턴)·uiStore·photoBlobs/photoGc·기기별 로컬 스토어들
  sync/                  ← settings·api·syncEngine(LWW merge, 409)·bootstrap(제로설정+주소이행)·photoSync·exportImport·backup·**session/sessionSwitch(세션 이름공간)·notice**
  admin/                 ← adminApi(admin.php 클라이언트)·keyCheck (M46/M47)
  archive/               ← archiveFiles(순수 규칙)·archiveApi (M46)
  timeline/              ← dayWindow(05시 경계 핵심!)·layout·route·gap·today·dayLabel — 전부 순수함수+테스트
  ai/                    ← aiClient(프록시 fetch)·prompts·aiSettings — SDK 없음, 키는 서버에만
  profile/               ← 2인 프로필 (song/hoyabom)
  components/            ← layout/trips/board/timeline/map/ai/common — 디자인 시스템은 index.css @theme + common/formStyles.ts
  utils/                 ← time·money·spend·colors·photos·flights·geo·url…
server/                  ← data.php·ai.php·image.php·**admin.php·archive.php**·config.sample.php·bootstrap-config.sample.json
e2e/                     ← Playwright 스펙 + mock-api.ts(전 서버 계약의 인메모리 목)
docs/                    ← deploy-synology.md(NAS 가이드)·HANDOFF.md(이 문서)
```

## 4. 절대 규칙 (지금까지 전 마일스톤이 지킨 것)

1. **schemaVersion은 1로 고정** — 모델 변경은 additive optional 필드만. 기존 사용자 데이터가 절대 깨지면 안 됨.
2. **Playwright 1.56.1 고정** — 컨테이너의 chromium 빌드(1194)와 맞물림. 업그레이드·`playwright install` 금지.
3. **하루 경계는 05시** (`timeline/dayWindow.ts`): 새벽(00~05시) 엔트리는 전날 창에 표시·집계. 일자 단위 UI는 반드시 windowed 트윈(daySpendWindowed 등) 사용, 달력 트윈은 결산/여행 범위용.
4. 병합은 엔티티 LWW + 톰스톤(30일 TTL) + 정렬배열 재조정 (`sync/merge.ts`). 사진 바이트는 워크스페이스 JSON 밖(별도 idb + image.php).
5. 완료 기준: `npm run typecheck && npm run build && npm run test && npm run e2e` **전부 그린** 후에만 커밋. 현재 기준선: **단위 1390 / e2e 259** (M51 — `viewportfit.spec` 6건 추가). (e2e는 `npm run preview`가 `dist/`를 그대로 내주므로 **돌리기 전에 반드시 `npm run build`** — 안 하면 옛 화면을 검사한다.)
6. 테스트ID·문구는 추가만(기존 것 변경 시 해당 스펙 최소 수정 + 커밋 메시지에 기록). 드래그 e2e는 스텝 이동+`--repeat-each` 재확인.
7. 커밋은 마일스톤 단위, 브랜치 `claude/mobile-macbook-session-sync-xs40tt`, PR 안 만듦. 모델명·세션 링크 외 AI 흔적을 저장소에 남기지 않음(커밋 트레일러는 기존 형식 유지).
8. 사용자 워크플로우 선호: **블록 단위로 Opus 서브에이전트에 위임**, 메인 세션이 검증·커밋. 큰 변경엔 적대적 검수 패스 추가. 완료 시 NAS 덮어쓰기용 zip 패키지 제공(사용자가 File Station으로 올림).
9. **매 배포(zip)마다 `src/patchNotes.ts` 맨 앞에 그 회차의 사용자 언어 변경사항을 추가한다 — NEW 배지가 그 id로 뜬다.**

## 5. 마일스톤 이력 (요약)

M0 스캐폴드 → M1 보드 → M2 타임라인+시트/항공편 마법사 → M3 지도 → M4 동기화+PWA → M5 Pages 배포 → M6 경로화살표+지출/코멘트 → M7 토론 기반 5기능(실행취소·오늘모드·백업넛지·결산·갭칩) → M8 QA 20버그픽스 → M9 디자인 시스템 전면 개편 → M10 사진 첨부 → M11 Gemini AI(프록시) → M12 목적지 센터링 → M13 2인 프로필 → M14 제로설정 부트스트랩 → M15 피드백4건(시트메뉴 버그 등) → M16(+검수 12건) 05시 경계+지출 요약바 → M17 AI 상세오류+카드만들기 → M18 모바일 헤더 압축+전역 타이포 수정 → M19 모바일 QA 10건 → M20 사진 자동 동기화+주소 자동 이행 → M21 메모 탭(여행별 카카오톡식 채팅 — `Workspace.memos` 소프트 삭제, 탭 5개) → M22 즉시 반영(메모 전송 즉시 푸시 + `?meta=1` 버전 폴링: 메모 탭 5초/그 외 30초/백오프) → M23 메모 QA(IME 조합 Enter 무시, 말풍선 롱프레스·우클릭 삭제 메뉴) → M24 사람 단위 안 읽음(`seenBy` 이름공간 키 `memo:`/`card:` — 메모 탭 배지·「여기까지 읽었어요」 구분선·카드 NEW 코멘트, `read/readState`) → M25 「필요 예산」 바(요약 바에서 지출을 걷어내고 **배치 단위** 계획 합계로: `sheetPlannedBudget`/`dayPlannedBudgetWindowed`/`sheetPlannedByColumn`/`unplacedPlan` + 기준·현지 두 통화 동시 표기 `dualAmount`) → M26 메모 클립보드 붙여넣기 + 백업 경고를 설정 시트로 → M27 지도 필터(`src/map/filter.ts` 순수 규칙: 범위 **전체 아이템/일정 전체/일자별(05시 창)/미확정** × 카테고리 = 범례 칩 하나, 선택은 `stores/mapFilterPref`로 기기별 기억) → M28 AI 장소 검색(`ai/aiPlaces.ts` 프롬프트·스키마·파서 + `map/placeSearch.ts`의 `searchPlacesSmart`: AI 켜져 있으면 Gemini에 먼저 묻고 — 「츠텐카쿠」→通天閣 현지 표기까지 결과 줄에 — 꺼짐·오류·429·빈 결과면 **자동으로 Nominatim**. 서버 변경 없음: 기존 `ask` kind + 스키마, 빈손일 때만 grounding 1회 재시도) → M29 할 일 체크리스트(`BoardColumn.todo?`/`Card.doneAt?` additive, `src/todo/` — 보드 카드 체크박스·카테고리 편집의 체크리스트 토글·하이드레이션 후 「할일」 이름 자동 채택(`adoptTodoColumns`, 명시적 false 존중)·일정 탭 「할 일 N」 버튼→TodoSheet 양방향 체크) → M30 서버 일 단위 백업(data.php `daily_snapshot`: 그날 첫 저장 직전 상태를 날짜별 보관·30일, 최선노력 — **서버 파일 변경이라 NAS에 api/data.php 교체 필요**) → M31 필요 예산 바에 지출 복귀 + 숙소 셈법(요약 바가 계획 옆에 **이미 낸 돈**을 뒤에·작게·0이면 없이 표시하고 카테고리별 팝오버가 둘 다 카테고리별로 쪼갬 — 계획은 배치 단위(M25) / 지출은 카드 단위(M6 `sheetSpend` 재사용), 좁은 폭에서는 지출이 팝오버로 물러남(390px 실측). 여기에 `BoardColumn.budgetOnce?` additive 필드: 숙소처럼 여러 날에 걸쳐도 결제가 한 번인 칸은 예산을 **시트마다 한 번**만 세고 그 한 번은 가장 이른 창에 붙음 — 새 여행의 🏨 숙소 칸은 켜진 채 태어나고, 이름이 숙소/호텔/hotel인 기존 칸은 `board/budgetOnce.ts`의 자동 이행이 한 번만 올려 주며, 카테고리 편집의 두 번째 토글로 끌 수 있음) → M32 지출 리포트(`report/spendReport.ts` + `SpendReportSheet` — 일정 탭 「리포트」 버튼(+좁은 폭은 예산 바 팝오버의 「전체 리포트 보기」)이 여는 엑셀형 표 두 장: 카테고리별 카드 단위 내역/소계/합계, 일자별(숙소·✈️항공권은 최상단 1회 고정) + 지출·예산·총액. 합계는 요약 바 함수 재사용이라 항상 일치, 미확정 제외) → M33 트레이 재배치 버그 수정(모바일 트레이가 미배치만 보여줘 한 번 놓은 카드를 다시 놓을 수 없던 문제 — 배치된 카드가 미배치 뒤에 반 톤 낮게 📅 배지째로 남아 드래그·탭 재배치 가능) → M34 일정 휴지통(배치된 블록을 끌 때만 danger 톤 바가 떠서 — 폰은 탭 바 바로 위(`bottom-[calc(3.5rem+safe)]`, 트레이는 덮어도 됨), 데스크톱은 창 맨 아래 — 거기 놓으면 그 **배치 하나만** 일정에서 빠지고 카드는 보드에 그대로 남음. `dnd/planDnd.ts`에 `TRASH_DROPPABLE_ID`·`resolveEntryDrop`·`planPointerPriority`(바가 그리드 **위에** 떠 있어 히트 테스트가 늘 「휴지통+일자 칸」 둘을 주므로 우선순위를 순수함수로 못박음), 삭제·실행취소는 엔트리 상세 시트의 삭제와 **같은** `stores/entryDelete.deleteEntryWithUndo` 하나를 공유. `fixed`라 나타나도 그리드를 밀지 않음 — 드롭 타깃이 손가락 밑에서 움직이는 사고 방지) → M35 좌표 정밀화+위치 확인(`map/refine.ts` — AI 후보의 **현지명을 Nominatim에 되물어** 3km 이내 히트에 좌표 스냅(`searchPlacesRefined`, 검색당 6요청 상한·세션 캐시·실패는 조용히 AI 좌표 유지, `✓ 지도 확인됨` 표시). 카드 편집의 위치 줄에 「위치 확인」 → 읽기 전용 미니맵(카테고리 핀·주소·좌표) + 「Google 지도에서 열기」) → M36 위치 재정비(`map/locationAudit.ts` + `LocationAuditSheet` — 설정 시트 맨 아래 조용한 링크(AI·활성 여행 필요, 이유는 줄 아래 한 마디): 활성 여행의 위치 카드를 순차 스캔(취소 가능, 카드당 후보 3·OSM 3, OSM 확정 좌표만 제안) → 현재↔제안 거리 목록(30m 미만·3km 초과·실패는 제외 구역) → 체크 선택 일괄 적용(좌표만, 주소 유지) + 배치 실행취소 「위치 N곳 재정비됨」) → M37 좌표 정확도 두 갈래 — **①주소 경유 스냅**: M35의 이름 스냅에는 「OSM에 그 가게가 없으면 모델의 기억 좌표가 표시 없이 남는다」는 구멍이 있었다(신고: 잇푸도 난바점이 구글 지도와 수백 m 차이). `map/refine.ts`에 두 번째 계단을 둬서, 이름으로 못 찾은 **앞 두 후보**(`ADDRESS_FALLBACK_CANDIDATES`)에 한해 grounded AI 한 번으로 좌표가 아닌 **정식 주소**를 되묻고(`ai/aiPlaces`의 `aiPlaceAddress`·`buildAddressPrompt`·`parseAddressAnswer`, 프롬프트 마커 `주소 확인 장소:`) 그 주소 문자열을 Nominatim에 넣어 같은 3km 안이면 스냅(`refinedBy:'address'` — 화면은 「✓ 지도 확인됨」 그대로, 줄에 `data-refined-by`). 실패·모름은 전부 조용히 AI 좌표 유지. 예산은 M35의 검색당 6요청을 그대로 나눠 쓴다(후보당 이름 2 + 주소 1). M36 훑기는 같은 기계를 부르므로 그대로 따라오되 카드당 grounded 1회(`AUDIT_ADDRESS_CANDIDATES`)이고, 429는 `proposeLocation`이 다시 던져 기존 fatal 정지가 받는다. **②좌표·링크 붙여넣기**: `map/coordInput.ts`의 `parseCoordInput`이 검색창 입력을 순수 함수로 읽어 좌표(`34.6659, 135.5013`)나 구글 지도 전체 주소(`!3d!4d` → `q=`/`query=` → `ll=`/`center=` → `@` 순, 0,0·범위 밖 거절)면 엔진을 통째로 건너뛰고 「좌표로 지정」 줄 하나를 띄운다 — 고르면 그 자리에 정확히 꽂히고 주소는 손 핀과 같은 `pinAddress` 표기(`위도, 경도`). 단축 링크(`maps.app.goo.gl`)는 브라우저에서 펼 수 없으므로 「단축 링크는 열어서 주소창의 전체 주소를 복사해 주세요」 한 줄로 말한다) → M38 일정표 직선거리 칩 제거(사용자 요청 — 그리드의 「직선 N km·시간이 부족해요」 갭 칩 삭제. `timeline/gap.ts`는 AI 일정 검토 프롬프트가 계속 쓰므로 유지, 지도 경로의 직선 표기도 유지, 해당 e2e 1건 삭제로 기준선 155→154) → M39 배치 카드 메모(기존 `TimelineEntry.note`를 엑셀 메모처럼 표면화 — 메모 있는 블록 우상단 접힌 종이 모서리 표시(`entry-note-mark`, ink/70)·호버 툴팁 미리보기(`timeline/entryNote.noteHint`), 편집은 엔트리 상세의 「메모」 그대로(자동 확장 textarea, `updateEntryNote`: 빈 값이면 키 제거·불변 시 no-op). 배치마다 독립 — 같은 카드 두 번 배치 = 메모 두 개. 모델 무변경. +entrytrash 모바일 터치 스펙 부하 안정화: 활성화 전 8px 이내 꼼지락+재시도, 실행취소 클릭은 M15식 dispatchEvent 재시도) → M40 시트 복제+패치노트(시트 ⋯ 메뉴 「복제」 — `duplicateSheet`: 일자·배치(메모 포함)·항공편 레그 깊은 복사, ✈️ 카드는 여행 공유라 참조 유지(한쪽 항공편 재편집이 다른 쪽을 못 깨뜨림, 테스트 고정), 이름 `(복사 N)` 순수 픽커. `src/patchNotes.ts` + `PatchNotesButton`(🎁): 데스크톱 유틸존+일정 제외 각 뷰 모바일 헤더, 새 패치면 중립 점 배지(`trip-board/patch-seen`), §4 규칙 9 신설) → M41 시트별 구글 지도 + 배치 위치 보정(`Sheet.mapEngine?: 'google'` additive — **없으면 OSM**이라 기존 시트는 전부 그대로. 새 시트 마법사와 ⋯ 메뉴 「복제」가 지도를 한 번 묻고(구글 키가 있는 기기에서만 그 줄이 보인다), `duplicateSheet(sheetId, engine?)`는 안 주면 원본을 따라간다. **렌더러만 갈린다**: 지도 탭의 「표시」가 고른 일정표가 구글 시트이고 범위가 그 일정표를 읽는 범위(일정 전체·일자별)일 때만 `GoogleMapView`가 서고, 전체 아이템·미확정·OSM 시트는 Leaflet 갈래를 **한 글자도 건드리지 않은 채** 그대로 쓴다. 무엇을 그릴지는 여전히 `map/filter.ts`·`timeline/route`가 정하므로 두 지도가 다른 답을 말할 수 없다 — 카테고리 색 핀·일자 색 동선·화살표(`icons: FORWARD_CLOSED_ARROW, repeat 80px`)·필터 바뀔 때만 fitBounds까지 같은 규칙. npm 의존성 0: `map/googleLoader.ts`가 script 태그 하나를 심고(`v=weekly&language=ko&libraries=marker,places&loading=async`), AdvancedMarkerElement가 요구하는 map id는 `DEMO_MAP_ID`(어떤 키로도 되는 문서화된 값, 나중에 클라우드 스타일 ID로 상수 하나만 교체). 키는 `bootstrap-config.json`의 `googleMapsKey`가 주고 기기의 `trip-board/gmaps-key`에 앉는다(`map/gmapsKey.ts`) — **키가 없으면 구글 시트도 조용히 OSM**으로 그리고 한 줄로 말한다(로더 실패도 같은 자리로). 그리고 **배치 시 위치 보정**: 구글 시트에 카드를 놓으면(드래그·탭 둘 다) 배치가 끝난 **뒤에** Places Text Search(New)로 카드 제목을 한 번 물어, 카드에 위치가 없거나 50m 넘게 다를 때만 두 핀을 담은 미니 지도 + 「기존 위치와 250m 차이」 + 「다른 시트와 지도에도 적용됩니다」 경고를 띄운다(`map/placeFix.ts` 순수 규칙, `stores/placeFixQueue` 길이 1 최신 우선, `PlaceFixHost`가 앱 껍데기에 하나). 결과 없음·오류는 팝업 없이 조용. e2e는 `window.__tripBoardFakeGoogle` 이음매에 `e2e/fake-google.ts`를 심어 **진짜 배선**(어떤 Polyline 옵션으로 불렀나, fitBounds를 불렀나, searchByText에 무엇을 넣었나)을 확인한다. SW: `bootstrap-config.json`을 navigateFallbackDenylist에 추가(직접 열면 index.html이 오던 자리), 구글 호스트는 runtimeCaching에 **일부러 없다**) → M42 내 위치+실경로+길찾기(지도 「내 위치」 버튼: watchPosition 파란 점+정확도 원, 가시성 연동 중단/재개, 양 엔진 공통(`map/geolocate.ts`). 구글 시트 일자별 보기: Routes v2 `computeRoutes`(`map/googleRoutes.ts` — TRANSIT→WALK 폴백, 다리당 세션 1회 캐시+null 기억, **`routingPreference` 금지**(TRANSIT에서 400, 테스트 고정))로 구간 실경로+소요시간 칩(`data-mode`), 실패 다리는 점선 유지. 핀 팝업(양 엔진)·엔트리 상세에 「길찾기」 = 구글맵 앱 딥링크(`map/directions.ts`, 일자별 활성 시 이전 정거장 origin). 폴리라인 디코더 자작(무의존), 패치노트 v11) → M43 주변 맛집(구글 시트 지도 **왼쪽 위** 🍜 토글 하나로 켜지는 참고 층 — 카드 핀·동선·필터는 이 레이어를 전혀 모르고, 끄면 통째로 사라진다. 출처가 둘이다: ①**큐레이션** `src/data/gourmet.ts`(타입 + 배열뿐, **로직 0** — 조사 에이전트의 전체 목록으로 통째 교체 가능. **좌표를 일부러 안 든다**: 손으로 적은 좌표는 늙으므로 `${localName} ${area}`로 Places Text Search를 **집당 기기 평생 한 번** 물어 `trip-board/gourmet-cache`(`localStorage`, 키가 `<판>:<엔트리 id>`라 판을 올리면 옛 줄이 조용히 버려진다)에 {lat,lng,address,googleRating,googleRatingCount,reservable?,placeId?,cachedAt}를 적는다. 순차·중단 가능(토큰), 진행은 「맛집 정보 불러오는 중 12/48」, **실패는 캐시하지 않아** 다음 활성화에서 다시 묻는다) ②**구글 실시간** `searchNearby`(New). **이중 필터**: 지금의 구글 평점이 4.3 미만이면 큐레이션이어도 감춘다(모르는 평점도 감춤) — 타베로그는 조사 스냅샷이라 늙지 않으므로 판정에 쓰지 않는다. 갈래→타입 표(`src/gourmet/nearby.ts`)는 구글이 이름을 가진 셋만 쓴다: 초밥 `sushi_restaurant`·라멘 `ramen_restaurant`·디저트 `dessert_shop`. **카츠·오코노미야키는 Places (New)에 타입이 없어**(`tonkatsu_restaurant`·`okonomiyaki_restaurant` 둘 다 존재하지 않는다) 현지어 키워드(`とんかつ`/`お好み焼き`) Text Search + `minRating: 4.3`으로 간다(`searchNearby`에는 `minRating`이 없다). 그래서 다섯 갈래를 다 켜도 한 번에 나가는 호출은 **최대 3개**이고, nearby가 400으로 떨어지면 그 갈래들도 키워드로 한 계단 내려간다. **지도를 미는 것만으로는 아무 호출도 안 나간다** — 켤 때 한 번 + 「이 지역에서 다시 검색」뿐이고 (중심 반올림, 갈래) 쌍은 세션 캐시. 패널은 둥근 버튼 둘 **아래**(`top-[9.5rem]`)에서 시작하고 팝업이 열리면 물러난다(390px에 둘을 세울 자리가 없다). 칩 = 장르 5(멀티)·예약 3·소스 3, 선택은 `stores/gourmetPref`로 기기별 기억(레이어를 켠 상태는 기억하지 않는다 — 켜는 순간 돈이 나간다). 핀은 24px 흰 원 + 갈래 이모지, 큐레이션만 금색 링(`gourmet-pin`, data-source/genre). 팝업(`gourmet-popup`)은 이름·장르·지역·「⭐ 구글 4.7 · 타베로그 3.7」/「(구글만)」·예약 세 갈래·한 줄 메모 + 「보드에 카드로 추가」(`matchColumn(columns,'식사')` 재사용 — 정확→느슨→첫 칸, `addCard`가 위치까지 한 번에 받으므로 카드 하나로 끝나고 메모는 평점 한 줄)·「구글 지도 앱에서 보기」(`map/directions.placePageUrl` — `query=<현지 상호>&query_place_id=<placeId>`라 폰에서 그 **가게 시트**가 바로 열린다)·「길찾기」(M42 그대로). `googlePlaces.ts`는 M41의 세 필드 검색을 건드리지 않고 형제 셋을 더했다(`GOURMET_FIELDS` = 기존 셋 + rating·userRatingCount·id·types; **`reservable`은 더 비싼 등급이라 일부러 뺐다** — 조사값이 그 자리를 채우고 구글 줄은 「예약 정보 없음」). e2e는 `fake-google.ts`에 질의별 canned 답(`__tripBoardFakeGooglePlacesByQuery`)·`searchNearby` 기록·`getCenter`·응답 지연(`__tripBoardFakeGoogleDelayMs`, 기본 0)을 **추가만** 했고, 스펙이 조사 데이터를 검사하지 않도록 이음매를 하나 더 뒀다: `src/gourmet/entries.ts`의 `gourmetEntries()`가 `window.__tripBoardGourmetEntries`를 호출 시점에 보고 있으면 그 목록을, 없으면 `GOURMET_ENTRIES`를 쓴다(번들 3줄, 로더·라우트와 같은 철학). `e2e/gourmet.spec.ts`는 자기 여섯 줄을 심어 배선만 확인하고, 마지막 한 건만 진짜 배열을 import해 「아무것도 안 심으면 조사 배열 첫 줄을 조회한다」를 못박는다 — 그래서 조사 배열이 통째로 갈려도(11줄→127줄, id 전부 변경) 스펙은 저절로 따라간다. 패치노트 v13) → M44 구글 우선 지오코딩(카드 위치 검색의 좌표 **원천**을 구글로 — M28~M37의 「AI로 이름을 얻고 OSM에 되물어 좌표를 조인다」에는 **OSM 색인에 없는 가게**라는 구멍이 있었고(신고: 「마루하치 슈퍼 난바점」이 찾을 때마다 다른 자리), 그 구멍에서는 모델의 기억 좌표가 표시 없이 남았다. M41의 구글 키가 그 색인을 여니 계단을 하나 위에 얹는다: `map/placeSearch.searchPlacesSmart`가 **구글 → AI → OSM** 세 계단이 되고, 첫 계단이 답하면 아래는 부르지 않는다(`source:'google'`). 새 조각은 둘뿐이다 — `googlePlaces.searchPlaceSuggestions`(M41의 세 필드 그대로, `maxResultCount` 5, `language:'ko'`, 목적지 좌표로 `locationBias`; 실패를 **던져서** 「못 찾음」과 「못 물음」을 부르는 쪽이 가르게 한다)와 `map/googlePlaceLookup.ts`(키 확인 + 로더 + 한 줄 변환: `refinedBy:'google'`·주소를 `locality`에 실어 카드 주소가 「이름, 정식주소」가 된다). **구글 결과는 보정을 지나지 않는다** — `searchPlacesRefined`의 조건이 이미 「AI에서 온 것일 때만」이라 코드는 한 줄도 안 늘었고, 이유는 「원본을 사본으로 바꾸지 않는다」. 키 없는 기기(Pages·부트스트랩 없는 배포)는 한 글자도 안 달라진다(`hasGoogle()`이 false면 부르지도 않는다). 구글이 못 찾거나 못 불렸는데 AI가 답한 화면에만 `GOOGLE_FALLBACK_NOTES` 한 줄이 붙는다 — OSM까지 내려간 화면에는 기존 `FALLBACK_NOTES`가 이미 「어디 결과인지」를 말하므로 한 줄에 사과를 두 개 담지 않는다. **위치 재정비(M36)**도 같은 원천으로: `locationAudit.ProposeDeps.googleSearch?`가 주어지면 그 길**만** 쓰고(구글이 모르면 「제안 없음」 — 이 도구의 첫째 규칙이 「모델의 기억을 다시 넣지 않는다」이므로 AI로 되돌아가지 않는다), 없으면 M36~M37 그대로. 설정의 게이트는 「AI **또는** 구글 키」로 넓어졌고 키가 있는 기기만 안내 한 줄이 바뀐다. 좌표 붙여넣기·손 핀(M37)과 배치 보정 팝업(M41)은 무변경) → M45 모바일 실사용 6건(**①「수정」 토글** — 「살짝 클릭 했는데 시간 조절이 됨」의 원인은 `EntryBlock`의 리사이즈 손잡이가 날 포인터 이벤트라 활성화 거리가 0인 것. 문턱을 두는 대신 **모드**를 둔다: `stores/timelineEdit.ts`(기본 꺼짐, `trip-board/timeline-edit`, 꺼짐은 키를 지운다) + 일정 헤더의 `timeline-edit-toggle`(`data-on`), 꺼져 있으면 손잡이를 **렌더하지 않는다**(리스너 미부착). 이동·탭·휴지통은 그대로 — 그 셋은 8px/250ms 문턱을 가진 제스처다. 헤더 폭 실측 결과 버튼 하나(48px)가 320/360px에서 페이지를 가로로 밀어서 `REPORT_NEEDS_PX`를 360/424 → **408/472**로 올리고(리포트가 한 칸 먼저 물러난다 — 두 번째 문은 M32의 예산 바 팝오버) 「수정」 자신도 `EDIT_NEEDS_PX = 344` 아래에서는 물러난다 **②드롭 자석** — `timeline/dropSnap.snapDropMin`(30분 격자)을 `PlanDndContext.resolveDrop`이 `dropTarget` **앞에서** 한 번 건다. 창의 시작이 05:00이라 오프셋 격자와 시계 격자가 같은 선 위에 있어 새벽 드롭도 :00/:30이고, 30의 배수는 15의 배수라 스토어의 `snapMin`이 다시 움직이지 않는다. 시트·상세의 ± 스테퍼는 15분 그대로 — 그 손가락은 정확하다 **③맛집 핀 가시성** — 24→32px, 테두리 잉크 2px, 그림자 강화, 그리고 핀 **아래** 「AI추천」 알약(`gourmet-pin-label`, 두 출처 공통). 바깥 묶음이 하나 생겼지만 데이터 속성·클릭은 전부 그 묶음이 들어 `[data-spot-key]` 배선은 그대로 **④맛집 패널 접기** — `gourmet-panel-toggle`. 접으면 `gourmet-panel`이 「주변 맛집 N곳」 알약 하나로 줄고(같은 testid, `data-collapsed`), 핀은 **접힘과 무관**하다. `stores/gourmetPref`에 `trip-board/gourmet-panel` 한 줄 추가(기본 펼침) **⑤맛집 로딩 속도** — 큐레이션 해석을 `gourmet/pool.runPool`(동시 폭 6, 워커는 만들어진 순서대로 칸을 집으므로 **첫 요청은 언제나 첫 줄의 것**, `stop`으로 중단, 진행은 완료 기준)로, 라이브 쿼리(nearby + 키워드)는 `Promise.all`로. `gourmet/cache.ts`는 **이미** 캐시된 항목을 재조회하지 않으므로(캐시에 있는 집은 `pending`에 아예 안 들어간다) TTL을 두지 않았다 — 두면 호출이 늘 뿐이다 **⑥모바일 지도 최대화** — `<640px`에만 `map-fullscreen`/`map-fullscreen-exit`(지도 왼쪽 위, 「내 위치」와 반대쪽). `map-root`가 `fixed inset-0 z-[45]`로(탭 바 z-40 위, 시트 z-50 아래) 커지고 `isolate`는 두 자세 모두에 남는다. Leaflet은 `MapReady`의 기존 `ResizeObserver`가 그대로 따라오고, 구글은 `GoogleMapView`에 같은 계약의 `ResizeObserver` + `maps.event?.trigger(map,'resize')`를 새로 달았다. 상태는 저장하지 않는다(세션). 패치노트 v14) → M45-fix 안드로이드 탭 바(신고: 안드로이드 크롬에서 **일정 탭에 들어가면 하단 탭 바가 통째로 사라지고 스크롤로도 안 돌아옴** — iOS·데스크톱·에뮬레이션(Pixel 7 뷰포트)에서는 재현 안 됨. 원인 판정: `TabBar`는 조건부 렌더가 없고 일정 탭에 그것을 덮는 요소도 없으므로, `position:fixed` + `backdrop-filter` 요소가 합성 레이어 많은 콘텐츠(일정 그리드의 sticky+블러) 위에서 페인트되지 않는 안드로이드 크롬 렌더링 버그로 결론. 수정: 폰의 아래쪽 바를 **불투명 `bg-surface`**로(블러 코드 경로 제거), `lg`의 위쪽 바(데스크톱)만 기존 반투명+블러 유지. 패치노트 v15) → M46 세션 다중화 + 관리자 전환 + 사진 보관함(**한 주소, 여러 워크스페이스, 관리자가 고른 하나를 전원이 본다**. 서버 저장 구조가 `DATA_DIR/sessions/<id>/{data.json,daily/,photos/,session.json}` + `DATA_DIR/active.json`으로 한 단계 깊어졌고, **업그레이드 후 첫 요청이 옛 `data.json`·`photos/`를 `sessions/default/`로 rename 한 번**(같은 볼륨·멱등·`.migrate.lock`) 옮긴다 — NAS에서 손댈 것은 없다. `?meta=1`과 워크스페이스 GET에 `"session"`이 additive로 붙고, **가장 중요한 것은 오염 방지**다: 클라이언트의 PUT·사진 업로드가 `X-Session`을 싣고 서버가 불일치를 **409 `session_changed`**로 거절한다 — 전환 직후 옛 탭이 옛 워크스페이스를 새 세션에 덮어쓰는 사고를 클라이언트가 아니라 **서버가** 막는다(헤더 없으면 구버전 클라이언트로 보고 활성 세션 처리). 클라이언트는 `sync/session.ts`(순수: id 정규식·`workspaceStorageKey`)와 `sync/sessionSwitch.ts`(idb 이름공간 교체)로 따라간다 — **`default`는 예전 키 `trip-board/workspace` 그대로**라 최초 이행 코드가 아예 없고, 다른 세션은 `trip-board/workspace:<id>`다. 전환은 **절대 병합하지 않는다**: 옛 상태는 옛 키에 그대로 남고(유실 0) 새 세션은 그 세션의 로컬 사본이나 **빈 워크스페이스**에서 시작해 서버에서 하이드레이션한다. `server/admin.php` 신설(`X-Admin-Token`·`hash_equals`, config.php의 `ADMIN_TOKEN` — 두 사용자가 다 가진 SYNC_TOKEN과 **일부러 분리**): list·create(소문자·숫자·하이픈 화이트리스트라 `..`이 존재할 수 없다)·rename(표시명만, **id는 불변** — 경로이자 모든 기기가 적어 둔 이름이다)·activate·보관함 폴더. **삭제는 만들지 않았다** — 되돌릴 수 없는 파괴는 File Station의 몫(백로그). 설정 시트 맨 아래 「관리자」 조용한 링크(위치 재정비와 같은 톤) → 비밀번호(메모리+`sessionStorage`, **localStorage 금지**) → 관리자 시트. 그리고 **사진 보관함**: `server/archive.php`(`X-Sync-Token` — 두 사람 다 올린다) POST 원본 바이트 그대로, **압축·리사이즈 없음**(카드 사진의 정반대), 확장자 화이트리스트 jpg/jpeg/png/heic/heif/webp(**동영상은 일부러 제외** — 수백 MB에 이어받기가 없다), 파일명 재구성 + 중복 시 타임스탬프, PHP 업로드 상한 초과는 한국어 안내. 클라이언트는 데스크톱 탭 바 유틸 존·모바일 여행 탭 헤더의 📤 버튼(동기화 미설정이면 숨김) → 시트에서 multiple 선택·순차 업로드·`n/N`·결과 요약) → M47 관리자 확장 6종 + 호버 메모(**①백업 복원** admin.php `backups`/`restore` — M30이 1년째 채워 온 `daily/`를 그대로 읽고, 복원 직전 상태를 `daily/` **밖의** `pre-restore-<ts>.json`으로 남긴 뒤 잠금 잡고 원자적으로 쓴다. **버전은 앞으로만 간다**(기존+1): 되돌렸다고 번호를 낮추면 이미 최신인 폰은 복원을 영영 모른다. 여기에 `restoredAt` 도장 하나를 더했다 — 평소의 LWW 병합이라면 각 기기가 「지운 적 없는」 엔티티를 복원 상태 위에 되얹으므로, 도장이 자기가 마지막으로 처리한 것보다 새로우면 클라이언트가 **통째로 채택**한다(`syncStore.lastRestoredAt`에 영속, 한 번만) **②세션 보관 + 내보내기** `session.json`의 `archived` 플래그 → data.php·image.php의 쓰기가 **423 locked**(한국어 사유), 클라이언트는 편집을 막지 않고 조용한 배너 한 줄로 말한다(`session-locked-banner`). `?action=export&id=`는 서버 봉투 `{version,updatedAt,data}`를 그대로 내려 줘 **설정 → 가져오기로 그대로 복원**된다(`deserializeBackup`이 이미 읽는 형식이라 두 번째 백업 포맷을 만들지 않았다) **③용량 대시보드** list 응답의 세션별 데이터/사진 용량 + 보관함 폴더 용량 + `disk_free_space`, 디렉터리 순회는 **60초 캐시 파일**(`.usage-cache.json`)로 묶어 액션마다 다시 걷지 않는다 **④공지** `DATA_DIR/notice.json` → `?meta=1`에 additive → 모든 탭 상단(`PersistBanner` **아래**: 저장 실패는 지금 데이터가 사라진다는 뜻이고 공지는 읽어 두라는 뜻이다)에 중립 톤 한 줄 + 닫기. 닫음은 기기별이고 **글자 기준**이다 — 같은 문장이 다시 올라오는 것은 새 소식이 아니고, 문장이 바뀌면 새 소식이다(`sync/notice.ts`) **⑤프로필 관리** `sessions/<id>/profiles.json` → meta로 전달. **id(`song`/`hoyabom`)는 절대 바꾸지 않는다** — 모든 카드·코멘트·영수증·`seenBy` 키에 박혀 있다. 바꿀 수 있는 것은 **표시 이름과 이모지 아바타뿐**이고, `resolveProfile(id, overrides)`가 오버라이드 없으면 `PROFILES[id]` **그 객체**를 돌려주므로 기존 세션·기존 화면·기존 e2e 문자열이 한 글자도 안 변한다(워크스페이스 밖 메타 파일이라 schemaVersion 무관) **⑥키 점검** ai.php의 기존 `?ping=1` 재사용 + 이 기기의 구글 키로 **실제 로더 성공까지** 확인(키가 있는데 거부되는 경우가 진짜 잡고 싶은 실패다) + archive.php `?check=1`(폴더 존재·쓰기 가능). ✓/✗ 세 줄 **⑦카드 호버 메모**(관리자와 무관) `(hover:hover) and (pointer:fine)`에서만, 보드 카드는 `card.memo`·일정 블록은 `entry.note`(M39)를 300ms 뒤 옆에 띄운다. 자리 계산은 `utils/hoverPopover.placeHoverPopover` 순수 함수(오른쪽 우선 → 안 맞으면 왼쪽 → 그래도 안 되면 창 안으로 clamp)이고 팝오버는 보이기 전에 한 번 측정해 배치한다. 터치는 `pointerType:'touch'`를 무시해 **변경 0**. M39가 `title=`에 붙여 뒀던 메모 줄은 팝오버로 **대체**했다 — 같은 블록에 툴팁이 둘 뜨는 것을 피하려고 `title`은 M39 이전처럼 카드 이름과 시각만 말한다(`e2e/entrynote.spec.ts`의 그 한 건을 최소 수정). 패치노트 v16) → M48 메모 표식 탭(**폰에서 메모를 빨리 보는 길**. M47의 호버 미리보기는 `(hover:hover) and (pointer:fine)`에서만 살고 폰에는 그 조건이 없다. 그렇다고 새 제스처를 낼 자리도 없다 — 카드/블록의 탭은 편집·상세이고 롱프레스 250ms는 드래그다. 그래서 **「메모가 있다」고 말하는 표식 자신을 탭 타깃으로** 만든다: 일정 블록은 M39의 접힌 모서리를 32px짜리 투명 버튼(`entry-note-tap`)이 감싸고(자국 `entry-note-mark`은 9px·`pointer-events-none` 그대로라 보이는 것은 한 픽셀도 안 달라진다), 보드 카드는 **메모 줄 끝에 32px짜리 📝 표식**(`card-note-mark`)이 선다. 처음에는 메모 줄 **전체**를 탭 타깃으로 삼았는데(카드에 이미 있던 표시를 쓴다는 뜻에서), 그 줄이 카드 한가운데를 가로지르는 탓에 **카드 가운데를 눌러 카드를 여는 길이 막혔다** — `gourmet.spec.ts`의 「보드에 카드로 추가」가 그 자리를 정확히 밟아 잡아 줬다. 표식은 줄 끝 하나로 족하다. 칩 줄에 📝 칩으로 넣지 않은 이유는 따로다: 칩은 우선순위대로 ＋N으로 접히는 자리(사진 칩이 늘 먼저 접힌다)라 정작 바쁜 카드에서 표식이 사라진다. 어느 쪽이든 **카드 높이는 그대로**다(32px 버튼의 위아래 9px를 마진으로 되돌린다). 호버와 탭은 `useHoverNote` **한 상태**를 쓴다: 탭으로 연 것은 `pinned`이라 포인터가 떠나도 남고(데스크톱에서 표식 클릭으로 고정 열람하는 것이 보너스로 따라온다), 바깥 `pointerdown`·스크롤(버블하지 않으므로 capture)·resize·같은 표식 재탭에 닫히며, 모듈 전역 슬롯 `openNote` 하나가 「한 번에 하나」를 지킨다(카드 스무 장이 훅을 하나씩 들고 있어 컴포넌트 안에서는 표현할 수 없다). 표식 버튼이 pointerdown·mousedown·touchstart 셋을 멈춰 세우므로 dnd 센서(MouseSensor 8px·TouchSensor 250ms)는 깨어날 기회가 없고 본체의 onClick도 열리지 않는다. 팝오버의 `pointer-events`는 호버면 `none`(유리 — 밑의 카드를 막지 않는다) 탭이면 `auto`인데, 폰에서는 팝오버가 자기를 낳은 카드 위에 겹치므로 통과시키면 「닫으려는 탭」이 그 카드를 열어 버린다. 자리 계산은 `utils/hoverPopover`를 **한 줄도 안 고치고** 재사용했다(390px 케이스 단위 테스트 2건만 추가 — 양쪽 다 안 맞으면 창 안으로 밀어 넣는 규칙이 이미 있었다). e2e는 `notetap.spec.ts` 2건 추가, `hovernote.spec.ts` 무변경, `entrynote.spec.ts`는 M48이 뒤집은 계약 한 줄(「자국을 눌러도 상세가 열린다」)만 블록 본체 클릭으로 바꿨다. 패치노트 v17) → M49 우리 맛집(**M43이 「남이 추천해 준 곳」이라면 이 층은 「우리 부부가 고른 곳」이다.** 그래서 구글에 물을 것이 하나도 없고, 데이터가 레이어가 아니라 **워크스페이스의 카드**로 산다. 세 조각이다.

**①상설 「맛집」 칸** `BoardColumn.gourmet?: boolean` additive(`todo?`(M29)·`budgetOnce?`(M31)와 **같은 삼항 규칙** — 없으면 평범한 칸, 명시적 `false`는 사람이 끈 것). `SEED_COLUMNS`에 여섯 번째 줄(🍚 맛집, orange)이 **맨 뒤에** 붙었고, 기존 여행은 하이드레이션 뒤 `board/gourmetColumn.adoptGourmetColumns()`가 받는다 — 앞의 두 이행과 다른 점은 한 걸음이 더 있다는 것이다: 이름이 「맛집」인 칸이 있으면 플래그만 켜고, **없으면 칸을 하나 만든다**(M49 이전에는 그 칸이 존재한 적이 없다). 판정은 여행 단위로 하나뿐이다 — 「그 여행의 어느 칸이든 `gourmet`을 이미 들고 있으면 손대지 않는다」. 그래서 멱등이고, 두 기기가 각자 돌려도 같은 값을 쓴다. 칸을 **지워 버리면 다음 로드에 돌아온다**(상설 칸의 뜻이 그것이다); 정말 원하지 않으면 카테고리 편집의 세 번째 토글(`column-gourmet-toggle`)로 끄면 `false`가 남아 아무도 손대지 않는다. **matchColumn 조정**: M43 팝업의 「보드에 카드로 추가」가 `pickGourmetColumn(columns) ?? matchColumn(columns,'식사')`가 됐다 — 첫 계단은 **이름이 아니라 플래그**로 찾으므로 칸 이름을 「먹킷리스트」로 바꿔도 따라오고, 없으면 M43 그대로 식사→느슨→첫 칸이다.

**②카드 장르** `Card.gourmetGenre?: string` additive(유니온이 아니라 `string`인 이유는 `CardExpense.by`가 그런 이유와 같다 — 이 계층이 `gourmet/`를 몰라야 하고, 모르는 값은 화면에서 「장르 없음」으로 접힌다). 갈래는 여덟이다: M43의 다섯(`gourmet/filter.ts`의 상수를 **그대로 펴서** 쓰므로 두 화면의 초밥이 다른 이모지를 달 수 없다) + 카페☕·식사🍚·술집🍶 (`gourmet/userGenres.ts`, 순수 데이터+토글 헬퍼). 픽커는 **맛집 칸의 카드 편집 시트에만** 서고(`card-genre-chip` 여덟, 같은 칩 재탭이 해제 — 「없음」 버튼을 따로 두지 않은 이유는 해제가 이미 같은 손가락 자리에 있기 때문), 맛집 칸이 아닌 카드를 편집할 때는 **원래 값을 그대로 되돌려 싣는다**(칸을 옮겼다고 이름표가 지워지지 않는다). 보드 카드는 제목 **앞**에 이모지 하나(`card-genre-mark`) — 칩 줄에 넣지 않은 이유는 M48이 📝를 칩으로 넣지 않은 이유와 같다(칩은 ＋N으로 접히는 자리라 바쁜 카드에서 표식이 사라진다).

**③지도 ⭐ 층** `components/map/UserGourmetLayer.tsx`(훅 + 토글 + 패널 + 팝업)가 **`MapView`의 오버레이**로 산다 — M43의 🍜가 `GoogleMapView` **안에** 살며 「구글 시트에만」을 사는 자리로 지킨 것과 정반대인데, 이유도 정반대다: 원천이 카드라 물어볼 곳이 없어 **두 엔진 모두**에서 뜬다. 엔진이 갈리는 것은 핀을 그리는 방법뿐이고(Leaflet `mapBase.userGourmetIcon` / 구글 `googlePin.createUserGourmetPinElement`), 무엇을 그릴지는 `gourmet/userSpots.ts`(순수)가 한 곳에서 정한다. **M27의 범위 필터를 통과하지 않는다** — 맛집 칸의 위치 있는 카드는 배치 여부와 무관하게 전부 선다(아직 어느 날에도 안 넣은 후보야말로 지도에서 봐야 하는 것이다). 핀은 M45의 AI 핀과 같은 32px·같은 자리의 이름표이되 링이 **초록**이고 이름표가 「내 맛집」(`usergourmet-pin-label`) — 색으로만 가르지 않는다. 필터는 장르 칩 8 + 「장르 없음」 포함 여부이고 선택은 `stores/userGourmetPref.ts`(기기별, M43과 같은 결). 위치 없는 카드는 패널의 「위치 없는 N곳」 한 줄로만 알린다(핀 불가). 팝업은 **두 엔진 같은 한 장**이다(Leaflet 네이티브 말풍선을 쓰면 같은 곳이 두 얼굴을 갖는다): 제목·장르·주소·메모 + 「보드에서 편집」·「길찾기」(M42 그대로). **390px 실측 결과 두 패널은 세로로 못 선다** — 위쪽 왼편에 버튼이 셋(전체화면·🍜·⭐)이 되면서 M43 패널이 `top-[9.5rem]`→`top-[12.25rem]`로 한 칸 내려갔고, ⭐ 패널은 그래서 **지도 아래쪽**(`inset-x-2 bottom-2`)에 산다 — 두 층을 동시에 켜도 패널이 겹치지 않는 유일한 배치다. 그 대가로 구글 갈래의 두 팝업 z가 `z-10`/`z-20` → `z-[1150]`/`z-[1160]`이 됐다(팝업은 언제나 패널(z-1050)을 이겨야 한다; 팝업은 화면 아래 두 칸에만 서므로 위쪽 둥근 버튼 z-1100을 가리지 않는다). ⭐ 버튼은 구글 시트에서 🍜 아래(`8.75rem`), 🍜이 없는 OSM 시트에서는 그 자리(`5.5rem`)에 선다 — 빈 칸을 남기면 「저기 뭔가 사라졌나」가 된다. 레이어를 **켠 상태는 기억하지 않는다**(M43은 돈이 나가서, 이쪽은 지도 탭의 기본 화면이 「이 여행의 일정」이어야 해서). 패치노트 v18).
→ **M50 6기 버그 헌터 수정 블록** (버그 20건 + 사용자 요청 1건 · M50-fix: v24의 상시 가로 스크롤바가 보드에서는 내용 맨 아래(화면 밖)에 붙어 보이지 않던 것을, 스크롤러와 scrollLeft를 양방향으로 묶은 `StickyHScrollbar` 대리 막대(sticky bottom, lg 전용, `board-hscrollbar`)로 교체 — index.css 스크롤바 블록이 `[data-scrollbar-proxy]`를 같은 목록에 든다. 패치노트 v20. M50-fix2: 안드로이드에서 하단 탭 바 소실·시트 확대·저장 버튼 실종이 재발 — 실체는 렌더링이 아니라 **입력칸 포커스 자동 확대가 풀리지 않고 고착**되는 것(확대되면 fixed 탭 바가 레이아웃 뷰포트 아래 = 화면 밖). index.html viewport에 maximum-scale=1, user-scalable=no 추가로 페이지 확대 자체를 잠금 — 지도 핀치는 라이브러리 자체 처리라 무관, iOS는 원래 user-scalable을 무시하므로 무변화. 패치노트 v21). 성격이 「새 기능」이 아니라 「이미 있던 것이 거짓말하던 자리」라, 대부분의 고침이 **규칙을 한 곳으로 모으는** 모양이다.

**①이동은 길이를 깎지 않는다** (헌터A #1·#2·#5 — 이 블록에서 가장 깊은 것). `utils/time.ts`에 `clampMove(start, duration)`가 **추가**됐다(`clampEntry`는 한 글자도 안 고쳤다 — 그것은 여전히 *생성·리사이즈*의 규칙이다). 갈라진 지점: `clampEntry`는 시작을 고정하고 자정을 넘는 만큼 **길이를 깎고**, `clampMove`는 길이를 지키고 **시작을 `[0, 1440−duration]`에 세운다**. 자정을 넘길 수 없다는 것은 모델의 제약(엔트리는 한 달력일에 매인다)이고, 그 제약은 시작이 멈추는 것으로 말해야지 일정이 썩는 것으로 말하면 안 된다. `workspaceStore.moveEntry`만 새 함수로 갈아탔고 `scheduleCard`·`newEntry`·`resizeEntry`는 그대로다. 미리보기가 거짓말하지 않도록 **두 스테퍼의 상한도 같은 값**으로 맞췄다(`EntryDetailSheet.stepStart`·`ScheduleSheet.stepStart`: `DAY_MIN − MIN_ENTRY_MIN` → `DAY_MIN − durationMin`) — 전에는 화면이 「23:45–02:45」를 보여 주고 스토어가 조용히 15분으로 잘라 넣었다. **기존 단위 스펙 1건을 뒤집었다**: `workspaceStore.test.ts`의 「shortens rather than overflows at the end of the day」(`{1395,45}`) → 「stops the start rather than shortening」(`{1320,120}`). 그 한 줄이 버그의 계약상 뿌리였다.

**②드래그 undo 완전 복원** (헌터A #2). `PlanDndContext`의 `from`에 `durationMin`이 실렸고, 되돌리기는 **먼저 옮기고 그 다음 늘린다** — 순서가 뒤집히면 늦은 시각에서 길이를 되찾으려다 `clampEntry`에 잘린다. `updateEntry`의 `EntryPatch`(note 전용)를 넓히지 않으려고 기존 두 액션만 조합했다.

**③폰 드래그 자동 스크롤** (헌터M1, 실측 636px → 37px). dnd-kit의 기본 문턱은 **컨테이너 높이의 비율**(0.2)이고 재는 대상이 손가락이 아니라 **끌고 있는 블록의 사각형**이다. 320×568에서 보이는 그리드는 170px, 한 시간 블록은 54px이라 블록 아래 모서리가 **가만히 있어도** 문턱 안이었다. `src/dnd/autoScroll.ts`(신규, 순수)의 `nearScrollEdge`가 **절대 24px · 손가락 기준**으로 다시 판정하고 `DndContext autoScroll={{acceleration:1.2, interval:10, canScroll}}`로 물린다. 가로·세로를 **또는**으로 묶어 보드 레일의 좌우 자동 스크롤은 살렸다.

**④Escape는 한 층만 닫는다** (헌터D2 #1). `ConfirmDialog`(+`PlaceFixDialog`)가 `MapModal`의 선례대로 **캡처 단계 + stopPropagation**으로 옮겼다. `Sheet`는 버블에서 듣고 있으므로 window 캡처가 먼저 삼킨다.

**⑤팝오버 탭이 밑의 카드를 열던 것** (헌터A #3). 고정된 `HoverNote` 팝오버는 자기를 낳은 카드 **위에** 겹치고 `pointer-events:auto`다. 바깥 닫기 리스너가 `pointerdown`에서 곧바로 닫아 버리면 뒤이어 오는 `click`이 갈 곳을 잃고 **밑의 카드로 재겨냥**된다. 이제 팝오버 자신의 `pointerdown`은 예외로 두고, 닫는 일은 팝오버의 `onClick`이 맡는다(그때는 클릭이 이미 배달된 뒤라 샐 곳이 없다).

**⑥일수 축소 = 무확인 소멸** (헌터A #4). `SheetWizard`가 저장 전에 **지워질 일자와 그 위의 배치를 센다**(✈️ 카드는 마법사 소유라 세지 않는다). 있으면 `ConfirmDialog`(「배치 N개가 있는 일자 M개가 삭제됩니다」)를 먼저 띄우고, 승낙하면 `undoDelete`와 같은 **스냅샷 되돌리기**(10초)를 함께 낸다.

**⑦메모 안읽음 파괴** (헌터M2 #3). 「동기화 설정」은 시트라 메모 탭 위에서도 열린다 — 거기서 프로필을 바꾸면 `MemoView`는 마운트된 채 `readKey`만 갈리고 읽음 이펙트가 **새 사람 이름으로 즉시** 「다 읽었음」을 찍었다. 이제 프로필이 방문 중에 갈리면 읽음을 **미루고**, 새 독자가 스레드를 실제로 만졌을 때(스크롤·누름) 푼다. 판정은 `visit`과 같은 이유로 **렌더 중**에 한다(이펙트로 미루면 갈린 그 렌더에서 읽음이 먼저 돈다).

**⑧두 지도 층의 자리 합의** (헌터M2 #1 = 헌터B #1, 헌터B #2). M49의 「위/아래로 나눠 놓았으니 안 겹친다」가 **폰 지도 상자가 낮으면 무너진다**(360×640에서 121px 겹침 실측). `components/map/mapLayerSlots.ts`(신규)가 모듈 슬롯 둘을 들고, 한쪽 패널이 펼쳐지면 다른 쪽은 알약으로 접힌다(층을 **켜는 것**도 펼치는 것으로 친다). 크게 펼쳐진 패널이 늘 하나뿐이므로 남은 자리가 계산 가능한 상수가 되고, `max-h`가 `55%`/`45%` → `calc(100% − …)`로 바뀌었다. 팝업도 같은 슬롯을 쓴다: 한쪽이 열리면 다른 쪽은 닫히고 **방금 연 쪽이 위**(`mapPopupZ`, 1160/1165 — ⭐의 고정 `z-[1200]`을 걷어냈다). 360·390·430 실측 겹침 0.

**⑨노치** (헌터B #5). 전체화면은 `fixed inset-0`이라 안전영역까지 먹는데 복귀 버튼만 그것을 알고 있었다. 지도 상자가 `--map-safe-top` CSS 변수를 한 번 심고(전체화면일 때만 `env(safe-area-inset-top)`, 아니면 `0px`), 🍜·⭐ 토글·「내 위치」·패널 top·오류 줄이 `calc(var(--map-safe-top,0px) + …)`로 읽는다. 프롭을 네 군데로 꿰지 않는 이유는 두 층이 서로 다른 파일에 있고 `fullscreen`을 모르기 때문이다.

**⑩나머지** — 제출 잠금 `components/common/useSubmitLock.ts`(신규 훅, ref여야 한다: 상태로 두면 두 번째 클릭이 리렌더 전에 옛 값을 읽는다)를 `CardEditSheet`·`ScheduleSheet`·`TripFormDialog`·`SheetWizard` 넷에 (헌터D2 #2·#3). 짧은 블록의 리사이즈 손잡이가 12px 고정이라 15분 블록(13.5px)의 **89%**를 덮던 것 → 높이의 1/3 이하로 줄이고 24px 미만 블록에는 아예 세우지 않는다(헌터A #6). 상세 시트 저장으로 창(일자)이 바뀌면 폰 페이저가 따라가고 「1일차로 이동했어요」(헌터A #8). 롱프레스로 메뉴가 열렸으면 뒤따르는 click 하나를 삼켜 라이트박스가 같이 열리지 않게(헌터M2 #2). 메모 초안(text+staged)을 `stores/memoDraft.ts`(신규, **메모리·비영속** — 보내지 않은 말은 동기화되어서도, 며칠 뒤에 되살아나서도 안 된다)로 승격(헌터B #4). 기준 통화를 현지 통화와 같게 바꾸면 짝을 즉시 정리(헌터B #3). 「직접 입력」 토글이 프리셋을 해제해 입력칸이 바로 뜨게(헌터A #7). `LocationAuditSheet` 본문도 구글 키 유무로 분기(헌터B #6). `googleFailed`를 **시트 전환에도** 리셋해 영구 폴백을 풀었다(헌터B 의심1).

**⑪사용자 요청 — 데스크톱 가로 스크롤바.** `pointer: fine`에서 `board-scroller`·`timeline-scroller`에 늘 보이는 스타일드 막대. **두 엔진에 따로 말해야 한다**: 크롬 121+는 `scrollbar-width`가 켜져 있으면 `::-webkit-scrollbar`를 통째로 무시하므로, `@supports selector(::-webkit-scrollbar)` 안에서 표준 속성을 `auto`로 되돌리고 가상요소로 그린다(가상요소를 그리는 것 자체가 겹침 막대를 자리 차지하는 고전 막대로 바꾼다). 파이어폭스는 `scrollbar-width: thin` + `scrollbar-color` 두 줄을 그대로 받는다. 폰은 지금까지대로 숨김. **컨테이너의 헤드리스 크로미움은 스크롤바를 아예 렌더하지 않아 실측 검증이 불가능했다** — 번들에 규칙이 실린 것과 `scrollbar-width`가 `auto`로 계산되는 것(=@supports 갈래가 맞았다는 뜻)까지만 확인했다. 실기 확인 필요.

패치노트 v19).

### M51 — 「하단 메뉴가 사라진다」의 진짜 원인 (2026-09-03)

M45-fix(backdrop-filter)·M50-fix2(확대 잠금)가 각각 다른 원인을 짚고 재발했던 그 증상의
**확정 판정**이다. Fable·Opus 두 토론자가 독립 분석에서 같은 결론에 도달했고, 헤드리스
크로미움 `isMobile` 컨텍스트에서 재현·계측했다.

**연쇄** (실측, Pixel 5 컨텍스트 384×747):

1. AI 도우미를 켠 폰에서 **일정 헤더 액션 줄이 356px**가 되어 뷰포트를 39px 넘긴다
   (`documentElement.scrollWidth` 423 > `innerWidth` 384).
2. Blink가 「내용 폭 맞춤」 최소 배율을 잡고 **레이아웃 뷰포트를 423×823으로 늘린다**.
3. `h-dvh`인 셸(`main`)은 가시 영역(384×747)에 남는데 `fixed`인 탭 바·시트는 늘어난
   레이아웃 뷰포트를 쓴다 → 탭 바가 화면 63px **아래**에, 시트가 오른쪽으로 39px 잘려
   그려지고 시트 푸터의 「저장」이 화면 밖으로 나간다.

**1차 원인은 ①의 오버플로다.** 순수한 배율 기억(삼성 인터넷의 사이트별 확대)만으로는 같은
프레임에서 `main` 폭 < 탭 바 폭이 될 수 없다 — 삼성 인터넷의 강제 줌·구 meta는 「최소 배율
< 1을 허용」하는 **조건**일 뿐이다. 그래서 ①②를 없애는 것이 근본이고 ③을 견디는 것은 방어층이다.

**세 층으로 고쳤다.**

1. **폭 예산(근본).** `TimelineView`에 상수 옆 실측 표를 두고 AI 두 개가 좁은 줄에서
   물러난다: `AI_REVIEW_NEEDS_PX = {icons:336, labels:768}`, `AI_ASK_NEEDS_PX =
   {icons:424, labels:768}`, 그리고 `EDIT_NEEDS_PX`가 M32의 `REPORT_NEEDS_PX`처럼
   두 단계가 됐다(`{plain:344, crowded:384}`). 두 대역인 이유는 `sm`(640px) 위에서 버튼마다
   이름이 붙어 필요 폭이 두 배가 되기 때문 — 하나의 기준선으로 뭉뚱그리면 640~767px에서
   그대로 넘친다(실측 +128px). **AI 묻기(✨)가 먼저 물러나는 이유는 보드 탭 헤더에 같은
   버튼이 하나 더 있어서**다. 보드 헤더는 320px에서 7px 넘쳤는데, 여기서는 버튼을 빼는 대신
   액션 묶음을 `flex-wrap`으로 바꿨다(✨ 두 개가 나란히 서면 어느 쪽이 무엇인지 안 읽힌다).
   실측: 320~1100px 전 구간, AI 켬/끔 양쪽에서 `scrollWidth == innerWidth`.
2. **그물.** `AppShell`의 `main`에 `overflow-x: clip`. `hidden`/`auto`가 **아닌** 이유는
   그 둘이 스크롤 컨테이너를 만들어 페이지 스크롤·sticky 날짜 머리·dnd 자동 스크롤을 상자
   안에 가두기 때문. html/body가 아닌 이유는 루트의 `clip`이 `hidden`으로 해석돼 문서 폭이
   줄지 않기 때문. 실측: 헤더에 88px를 강제로 밀어 넣어도 `innerWidth`가 384로 고정된다.
3. **fixed 요소의 `dvw`/`dvh` 앵커.** `index.css`의 `.tb-vp-fill`(전면 오버레이)·
   `.tb-vp-bottom`(하단 바, `--tb-vp-bottom-offset`로 탭 바 높이만큼 더 올림)·
   `.tb-vp-cap`(포털 팝오버 폭 상한). `lg` 미만에서만, `@supports (width:100dvw)` 안에서만
   켠다(데스크톱 고전 스크롤바에서 `100dvw`는 가로 스크롤을 **만들어 낸다**; 미지원
   브라우저에서는 규칙이 통째로 사라지고 기존 `inset` 선언이 그대로 산다). `dvh`는 소프트
   키보드에 반응하지 않으므로 입력 포커스 때 셸이 쪼그라드는 새 버그가 없다 — JS
   `visualViewport` 방식을 일부러 쓰지 않은 이유다. 층 3만 단독 검증: `clip`을 끄고 레이아웃
   뷰포트를 455×886으로 늘린 상태에서도 탭 바 690~747·시트 0~384×0~747·저장 691~735.

**viewport 메타 롤백.** M50-fix2가 넣은 `maximum-scale=1.0, user-scalable=no`를 **걷어냈다**.
원인이 확대가 아니라 폭이었으므로 잠글 이유가 없고, 확대 금지는 저시력 사용자에게서 확대를
빼앗는 접근성 손실이다. 지금은 `width=device-width, initial-scale=1.0, viewport-fit=cover`.

**개발 빌드 카나리아.** `AppShell`이 `import.meta.env.DEV`에서만 `innerWidth >
visualViewport.width`를 2초마다 보고 `console.warn` 한 줄을 남긴다 — body 포털에서 무언가
넘치면(그것은 `main`의 clip 밖이다) 다음 개발자가 즉시 안다.

**회귀 스펙 `e2e/viewportfit.spec.ts` (신규 6건).** 기존 253건이 이 결함을 못 잡은 이유는
전부 **데스크톱 컨텍스트**(`isMobile: false`)였기 때문이다 — 그 컨텍스트의 Chromium은
`<meta name="viewport">`를 읽지 않고 모바일 스케일링도 하지 않으므로, 뷰포트를 384px로
줄여도 그것은 「작은 데스크톱 창」이지 폰이 아니다. 새 스펙은 `devices['Pixel 5']`
(`isMobile: true`)로 384×747·360×640에서 ①다섯 탭 ②엔트리 시트 ③AI 켬/끔 양쪽의 헤더
(접기 chevron의 오른쪽 끝 ≤ `innerWidth`) ④**헤더를 강제로 넘치게 만들어도** 탭 바가 화면
안에 남는지를 못박는다. 단언 세 줄은 `innerWidth === visualViewport.width`,
`documentElement.scrollWidth <= innerWidth`, 탭 바·시트 푸터의 bottom ≤ `visualViewport.height`.

패치노트 v22.

## 6. 보류/백로그 (토론·검수에서 합의된 순서)

1. 시트 복제 (M7 토론 합의, 다음 1순위)
2. 카드 전역 검색 (카드 30장+ 시점)
3. 체크리스트 — memo `- [ ]` 렌더 방식(스키마 변경 0안)
4. 결산 확장(일자별 지출 바, 텍스트 복사), 현지통화 소급 표시 확장
5. `--color-ink-faint` 대비 AA 미달(3.1:1) — M9 팔레트 전역 조정 필요 (M19에서 보류)
6. dropTarget의 새벽 존 드롭이 달력상 비인접 다음 행일 때의 잔여 엣지 (M16-fix 5번 항목에 기록)
7. 안드로이드 뒤로가기로 시트 닫기(히스토리 연동) — 알려진 제한
8. 달력 트윈(daySpend 등) 데드코드 정리 여부 결정
9. 세션 삭제 (M46에서 의도적으로 만들지 않음 — 파괴적, 지금은 File Station의 몫)
10. **모바일 컨텍스트 e2e는 새로 생긴 그물이다 (M51).** 253건 전부가 `Desktop Chrome`
    (`isMobile: false`) 컨텍스트라, `<meta name="viewport">`도 모바일 스케일링도 검사되지
    않았다 — 그것이 「하단 메뉴 소실」이 세 번(M45-fix·M50-fix2·M51) 재발한 구조적 이유다.
    지금 `e2e/viewportfit.spec.ts` 하나만 `isMobile: true`이고, 다른 스펙들은 여전히
    데스크톱 컨텍스트에서 폭만 줄여 검사한다. **폰에서만 나는 증상을 다룰 때는 새 스펙을
    `devices[...]`로 세워야 한다** — 기존 스펙의 뷰포트를 줄이는 것으로는 재현되지 않는다.
11. 640~767px(폴더블 펼침 등)에서는 일정 헤더의 AI 두 개가 물러난다 — 그 대역은 버튼마다
    이름이 붙어(`sm`) 필요 폭이 768px이기 때문(M51의 실측 표). 이름을 좁은 대역에서만
    접는 세 번째 단계를 두면 되돌릴 수 있으나, 실기기가 드물어 미룬다.
12. 데스크톱 상시 가로 스크롤바(M50-fix ⑪)는 컨테이너 헤드리스 크로미움이 스크롤바를
    렌더하지 않아 여전히 실기 확인이 필요하다.
13. **`photos.spec.ts:200`(사진 포함 백업 왕복)은 전체 스위트 부하에서만 늦는 스펙이다.** 단독 실행은 매번 14s 안에 끝나는데 259건 병렬 실행에서는 「가져왔어요」 알림 대기 15s가 세 번 모자랐다(M50~M51 게이트 4회 중 3회). M51에서 그 대기만 30s로 늘렸다 — 건너뜀이 아니라 기다림. 다시 빨개지면 부하가 아니라 진짜 회귀로 보고 단독 재실행부터.

## 7. 다음 세션 시작 방법 (사용자용 가이드)

1. claude.ai/code (또는 모바일 앱)에서 **새 세션** 생성 → 저장소 `ls9702/claude01` 연결, 브랜치 `claude/mobile-macbook-session-sync-xs40tt`
2. 첫 메시지 예시: **"docs/HANDOFF.md 읽고 이어서 진행. 오늘 할 일: ○○○"**
3. 새 기능은 기존 방식(블록 단위 Opus 위임→검증→커밋→zip 패키지)으로 요청하면 됨
4. NAS 반영: Claude가 주는 zip을 File Station으로 `web/travel/`에 덮어쓰기 (api/config.php·data/·bootstrap-config.json은 zip에 없으므로 안전)
5. 토큰·키를 채팅에 올릴 필요 없음 — 전부 NAS의 config.php/bootstrap-config.json에만 존재
