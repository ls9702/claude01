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
| 서버 파일 | `web/travel/api/{data,ai,image}.php` + `config.php`(SYNC_TOKEN·GEMINI_API_KEY·DATA_DIR — **git에 없음, NAS에만**) |
| 자동 설정 | `web/travel/bootstrap-config.json`(주소+토큰, **git에 없음**) — 새 기기 무설정 연결, 주소 변경 시 자동 이행 |
| 데이터 | `api/data/workspace.json`(+백업 5개 로테이션), 사진 `api/data/photos/<id>.jpg` |
| 공유기 | ASUS TUF-AX5400, 정적 포워딩 80/443→192.168.50.2 (5000/5001 DSM용) |
| 배포 방법 | dist/ 빌드 결과 + (서버 변경 시) api/*.php를 `web/travel/`에 **덮어쓰기**. config.php·data/·bootstrap-config.json은 건드리지 않음. GitHub Pages는 브랜치 push 시 deploy.yml이 자동 처리 |

## 3. 기술 스택 / 저장소 구조

Vite 7 · React 19 · TS · Tailwind 4(CSS-first `@theme`) · zustand 5 · dnd-kit · Leaflet+OSM · idb-keyval · vite-plugin-pwa. 백엔드는 순수 PHP 3파일(프레임워크·DB·Docker 없음).

```
src/
  types/models.ts        ← 데이터 계약 (schemaVersion 1 고정, 추가는 optional 필드만!)
  stores/                ← workspaceStore(모든 뮤테이션, run() 패턴)·uiStore·photoBlobs/photoGc·기기별 로컬 스토어들
  sync/                  ← settings·api·syncEngine(LWW merge, 409)·bootstrap(제로설정+주소이행)·photoSync·exportImport·backup
  timeline/              ← dayWindow(05시 경계 핵심!)·layout·route·gap·today·dayLabel — 전부 순수함수+테스트
  ai/                    ← aiClient(프록시 fetch)·prompts·aiSettings — SDK 없음, 키는 서버에만
  profile/               ← 2인 프로필 (song/hoyabom)
  components/            ← layout/trips/board/timeline/map/ai/common — 디자인 시스템은 index.css @theme + common/formStyles.ts
  utils/                 ← time·money·spend·colors·photos·flights·geo·url…
server/                  ← data.php·ai.php·image.php·config.sample.php·bootstrap-config.sample.json
e2e/                     ← Playwright 스펙 + mock-api.ts(전 서버 계약의 인메모리 목)
docs/                    ← deploy-synology.md(NAS 가이드)·HANDOFF.md(이 문서)
```

## 4. 절대 규칙 (지금까지 전 마일스톤이 지킨 것)

1. **schemaVersion은 1로 고정** — 모델 변경은 additive optional 필드만. 기존 사용자 데이터가 절대 깨지면 안 됨.
2. **Playwright 1.56.1 고정** — 컨테이너의 chromium 빌드(1194)와 맞물림. 업그레이드·`playwright install` 금지.
3. **하루 경계는 05시** (`timeline/dayWindow.ts`): 새벽(00~05시) 엔트리는 전날 창에 표시·집계. 일자 단위 UI는 반드시 windowed 트윈(daySpendWindowed 등) 사용, 달력 트윈은 결산/여행 범위용.
4. 병합은 엔티티 LWW + 톰스톤(30일 TTL) + 정렬배열 재조정 (`sync/merge.ts`). 사진 바이트는 워크스페이스 JSON 밖(별도 idb + image.php).
5. 완료 기준: `npm run typecheck && npm run build && npm run test && npm run e2e` **전부 그린** 후에만 커밋. 현재 기준선: **단위 573 / e2e 93**.
6. 테스트ID·문구는 추가만(기존 것 변경 시 해당 스펙 최소 수정 + 커밋 메시지에 기록). 드래그 e2e는 스텝 이동+`--repeat-each` 재확인.
7. 커밋은 마일스톤 단위, 브랜치 `claude/mobile-macbook-session-sync-xs40tt`, PR 안 만듦. 모델명·세션 링크 외 AI 흔적을 저장소에 남기지 않음(커밋 트레일러는 기존 형식 유지).
8. 사용자 워크플로우 선호: **블록 단위로 Opus 서브에이전트에 위임**, 메인 세션이 검증·커밋. 큰 변경엔 적대적 검수 패스 추가. 완료 시 NAS 덮어쓰기용 zip 패키지 제공(사용자가 File Station으로 올림).

## 5. 마일스톤 이력 (요약)

M0 스캐폴드 → M1 보드 → M2 타임라인+시트/항공편 마법사 → M3 지도 → M4 동기화+PWA → M5 Pages 배포 → M6 경로화살표+지출/코멘트 → M7 토론 기반 5기능(실행취소·오늘모드·백업넛지·결산·갭칩) → M8 QA 20버그픽스 → M9 디자인 시스템 전면 개편 → M10 사진 첨부 → M11 Gemini AI(프록시) → M12 목적지 센터링 → M13 2인 프로필 → M14 제로설정 부트스트랩 → M15 피드백4건(시트메뉴 버그 등) → M16(+검수 12건) 05시 경계+지출 요약바 → M17 AI 상세오류+카드만들기 → M18 모바일 헤더 압축+전역 타이포 수정 → M19 모바일 QA 10건 → M20 사진 자동 동기화+주소 자동 이행.

## 6. 보류/백로그 (토론·검수에서 합의된 순서)

1. 시트 복제 (M7 토론 합의, 다음 1순위)
2. 카드 전역 검색 (카드 30장+ 시점)
3. 체크리스트 — memo `- [ ]` 렌더 방식(스키마 변경 0안)
4. 결산 확장(일자별 지출 바, 텍스트 복사), 현지통화 소급 표시 확장
5. `--color-ink-faint` 대비 AA 미달(3.1:1) — M9 팔레트 전역 조정 필요 (M19에서 보류)
6. dropTarget의 새벽 존 드롭이 달력상 비인접 다음 행일 때의 잔여 엣지 (M16-fix 5번 항목에 기록)
7. 안드로이드 뒤로가기로 시트 닫기(히스토리 연동) — 알려진 제한
8. 달력 트윈(daySpend 등) 데드코드 정리 여부 결정

## 7. 다음 세션 시작 방법 (사용자용 가이드)

1. claude.ai/code (또는 모바일 앱)에서 **새 세션** 생성 → 저장소 `ls9702/claude01` 연결, 브랜치 `claude/mobile-macbook-session-sync-xs40tt`
2. 첫 메시지 예시: **"docs/HANDOFF.md 읽고 이어서 진행. 오늘 할 일: ○○○"**
3. 새 기능은 기존 방식(블록 단위 Opus 위임→검증→커밋→zip 패키지)으로 요청하면 됨
4. NAS 반영: Claude가 주는 zip을 File Station으로 `web/travel/`에 덮어쓰기 (api/config.php·data/·bootstrap-config.json은 zip에 없으므로 안전)
5. 토큰·키를 채팅에 올릴 필요 없음 — 전부 NAS의 config.php/bootstrap-config.json에만 존재
