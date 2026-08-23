# Trip Board ✈️

여행 아이디어를 **브레인스토밍 보드**(칸반)에 카드로 모으고, 카드를 **일자별 타임시트**(시간축 일정표)로 드래그해 실제 일정을 짜는 개인용 여행 계획 PWA.

**접속**: https://ls9702.github.io/claude01/ — 모바일/PC 브라우저에서 열고, 브라우저 메뉴의 "홈 화면에 추가 / 앱 설치"로 앱처럼 사용 가능.

## 주요 기능

- **여행** — 여행 생성 시 기본 카테고리 5종 시드: 🚗 이동수단 / 📌 할일 / 🍽️ 식사 / 🏨 숙소 / 🎡 볼거리 (자유 추가·수정)
- **보드** — 카드(메모·URL·예산·소요시간·위치) 생성, 카테고리 간 드래그 정렬
- **일정** — 타임시트 여러 개(시나리오 비교). ✈️ 항공편 입력 시 일자·항공편 일정 자동 생성. 보드/트레이에서 카드를 드래그해 15분 단위로 배치, 리사이즈·이동·실행취소. 모바일은 롱프레스 드래그 + 탭 배치 폴백
- **지도** — 위치 지정 카드를 카테고리 색·아이콘 핀으로 표시, 장소 검색(Nominatim)·지도에서 핀 선택
- **저장/동기화** — 기기별 로컬 저장(IndexedDB), JSON 내보내기/가져오기. 시놀로지 NAS 연동(`server/data.php`) 준비됨 — 동기화 설정에서 주소/토큰 입력 시 활성화

## 개발

```bash
npm install
npm run dev        # 개발 서버
npm run typecheck  # 타입 검사
npm run test       # 단위 테스트 (vitest)
npm run e2e        # E2E (Playwright, 사전 빌드 필요: npm run build)
npm run build      # 프로덕션 빌드 (VITE_BASE로 하위경로 지정)
```

## NAS 배포 (Phase B 예정)

Web Station에 `dist/` + `server/`(`config.php`에 토큰 설정)를 올리고 `VITE_BASE=/travel/`로 빌드. 상세 가이드는 추후 `docs/deploy-synology.md`로 제공.
