# 시놀로지 NAS 배포 가이드 (Phase B)

목표: `https://trip.863ad.co.kr` 에서 Trip Board를 자가호스팅하고, 기기 간 자동 동기화 + AI 도우미를 켠다.

전제 (완료된 상태):
- 가비아 DNS: `trip` CNAME → `ls9702.synology.me.` ✅
- 시놀로지 DDNS(`ls9702.synology.me`) + QuickConnect 동작 중 ✅
- 배포 패키지 `trip-board-nas.zip` (앱 빌드 + `api/` 서버 파일 + 토큰이 채워진 `config.php`)

---

## 1. 공유기 포트포워딩 (외부 80/443 → NAS)

인터넷 공유기 관리 페이지에서:
- 외부 **80** → NAS 내부 IP의 **80** (Let's Encrypt 발급용 — 발급 후 닫아도 됨)
- 외부 **443** → NAS 내부 IP의 **443** (서비스용, 항상 열어둠)

이미 DSM에 외부 접속이 되고 있다면 5000/5001은 열려 있을 텐데, 80/443이 추가로 필요합니다.

## 2. Let's Encrypt 인증서 발급 (DSM)

DSM → **제어판 → 보안 → 인증서 → 추가 → 새 인증서 추가 → Let's Encrypt**
- 도메인 이름: `trip.863ad.co.kr`
- 이메일: 본인 메일
- (같은 인증서에 `863ad.co.kr;www.863ad.co.kr` 를 SAN으로 추가해도 됨)

발급 실패 시: 1단계의 80 포트 포워딩과 DNS 전파(추가 후 30분)를 확인.
발급 후 **인증서 → 설정**에서 이 인증서를 곧 만들 `trip.863ad.co.kr` 서비스에 할당.

## 3. Web Station + PHP 설치

**패키지 센터**에서:
- **Web Station** 설치
- **PHP 7.4** (또는 8.x — 있는 최신 버전) 설치
- Web Station → **스크립트 언어 설정 → PHP** → 프로필 생성(기본값이면 충분, 확장 모듈 중 **curl, openssl, mbstring** 켜짐 확인)

## 4. 파일 업로드

File Station에서 `web` 공유 폴더 아래 `travel` 폴더 생성 → `trip-board-nas.zip` 업로드 → 압축 해제 → **zip 안의 내용물**(index.html, assets/, api/ …)이 `web/travel/` 바로 아래에 오도록 정리.

```
web/travel/
├─ index.html, assets/, icons/, sw.js, manifest.webmanifest …
└─ api/
   ├─ data.php   ├─ ai.php   ├─ image.php
   └─ config.php   ← 동기화 토큰이 이미 들어 있음
```

## 5. 가상 호스트 생성 (Web Station)

Web Station → **웹 서비스 포털**(또는 웹 서비스 → 생성) → **가상 호스트**:
- 호스트 이름: `trip.863ad.co.kr`
- 포트: **HTTPS 443** (HTTP→HTTPS 리디렉션 옵션 있으면 켜기)
- 문서 루트: `web/travel`
- 백엔드: 웹 서버 기본(nginx) + **PHP 프로필 선택** ← 중요 (PHP를 안 고르면 api가 다운로드됨)

생성 후 2단계 인증서가 이 호스트에 할당됐는지 다시 확인.

## 6. 권한 + (선택) 데이터 위치 하드닝

- `api/data/` 는 첫 저장 때 자동 생성됩니다. 실패하면 File Station에서 `web/travel/api` 폴더 속성 → 권한에 **http** 사용자 쓰기 권한 부여.
- 카드 사진은 `api/data/photos/` 에 id 하나당 JPEG 한 장으로 쌓입니다(`image.php`가 첫 업로드 때 폴더를 만듭니다). 장당 500KB 안팎이니 공간만 넉넉하면 따로 설정할 건 없어요.
- **일 단위 백업(M30)**: 매일 첫 저장 때 직전 상태가 `api/data/daily/workspace-YYYYMMDD.json` 으로 자동 보관됩니다(30일 유지, 설정 불필요). 복구가 필요하면 원하는 날짜 파일을 열어 `data` 부분을 확인하거나, File Station으로 내려받아 앱의 「가져오기」에 쓸 수 있어요.
- **선택(권장)**: 데이터를 웹 루트 밖으로 — File Station에서 `web` 밖에 폴더를 만들기 어렵다면 최소한 Web Station의 **기본 서버(default server)** 문서 루트가 `web` 전체를 서빙하지 않는지 확인하고, 가능하면 `config.php`의 `DATA_DIR`을 웹으로 서빙되지 않는 경로로 변경.

## 7. 동작 확인

브라우저에서:
- `https://trip.863ad.co.kr` → 앱이 뜸 (자물쇠 아이콘 = 인증서 정상)
- `https://trip.863ad.co.kr/api/data.php` → `{"error":"unauthorized"}` 가 뜨면 **정상** (토큰 없이 접근 차단 중)
- `https://trip.863ad.co.kr/api/image.php?id=abcdef` → 마찬가지로 `{"error":"unauthorized"}` (사진도 토큰 없이는 못 봐요)

## 8. 앱 연결

`https://trip.863ad.co.kr` 접속 → 우측 상단 동기화 칩 → 동기화 설정:
- 서버 주소: `https://trip.863ad.co.kr/api`
- 토큰: `config.php`의 `SYNC_TOKEN` 값
- **연결 테스트** → 성공 → 저장

기존 데이터 이사: 예전 주소(GitHub Pages)에서 **내보내기**(사진 있으면 「사진 포함 내보내기」) → 새 주소에서 **가져오기**. 홈 화면 앱도 새 주소로 다시 설치. 다른 기기들도 같은 주소+토큰을 넣으면 자동 동기화 시작.

## 8-1. 제로 설정 (bootstrap-config.json)

두 번째 사용자가 아무 설정 없이 쓰게 하려면, 앱 폴더(문서 루트, index.html 옆)에 `bootstrap-config.json` 파일을 올려두세요:

```json
{
  "sync": { "baseUrl": "https://주소/api", "token": "config.php와 같은 토큰" },
  "aiEnabled": true
}
```

- 새 기기가 앱을 열면 동기화 주소·토큰이 자동 입력되고 AI 토글이 자동으로 켜집니다 — 첫 화면에서 프로필(S/HB) 선택만 하면 끝.
- 사용자가 직접 저장/해제한 기기에서는 자동 설정이 덮어쓰지 않습니다 (해제한 기기는 리로드해도 재연결 안 됨).
- 이 파일에는 토큰이 들어 있으므로 **NAS에만** 두고 저장소에는 올리지 않습니다(.gitignore 처리됨).

구글 지도를 쓰는 기기에는 `"googleMapsKey": "AIza..."` 한 줄을 같이 넣습니다(M41·M42). 그 키가 있는 기기에서만 시트의 지도를 구글로 고를 수 있고, 없으면 앱은 조용히 OSM 지도로 그립니다. 구글 클라우드 콘솔에서 그 키에 **Maps JavaScript API · Places API (New) · Routes API** 셋을 켜고, HTTP 리퍼러를 이 주소로 제한해 두세요 — 앱이 쓰는 유료 호출은 배치할 때의 장소 확인 한 번과 일자별 지도를 볼 때 그 날의 다리 수(N-1)뿐이고, 같은 다리는 한 번만 묻습니다.

## 9. AI 도우미 켜기

1. https://aistudio.google.com/apikey 에서 발급받은 키를 `web/travel/api/config.php` 의 `'GEMINI_API_KEY' => ''` 따옴표 안에 붙여넣기 (파일은 NAS 안에만 존재 — 브라우저로 절대 전송되지 않음)
2. 앱 → 동기화 설정 → **AI 도우미 토글 ON** → 상태가 「사용 준비 완료」로 바뀌면 보드 ✨ AI 추천 / 일정 AI 검토 / 질문 버튼이 나타남

## 문제 해결

| 증상 | 확인 |
|---|---|
| 사이트 안 열림 | DNS 전파(nslookup trip.863ad.co.kr), 443 포워딩, 가상 호스트 호스트명 오타 |
| 인증서 경고 | 2단계 인증서가 이 호스트에 할당됐는지 |
| api가 파일로 다운로드됨 | 가상 호스트에 PHP 프로필 미지정 |
| 연결 테스트 실패 | 주소 끝 `/api` 포함 여부, 토큰 복사 오류, `data.php` 직접 열어 unauthorized 확인 |
| 저장 오류(storage_error) | 6단계 권한 |
| AI 상태 「서버에 AI 키가…」 | config.php 키 오타/누락, PHP curl 확장 |

앱 업데이트 방법: 새 빌드가 나오면 `web/travel/` 의 앱 파일들(index.html, assets/, sw.js 등)만 교체 — `api/config.php` 와 `api/data/` 는 그대로 두면 됩니다.
