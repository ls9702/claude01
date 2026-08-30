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
   ├─ data.php   ├─ ai.php   ├─ image.php   ├─ admin.php   ├─ archive.php
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

## 10. 관리자 기능 · 사진 보관함 켜기 (M46/M47)

이 회차는 **서버 파일이 바뀝니다.** zip을 `web/travel/`에 덮어쓸 때 아래 네 가지를 같이 해 주세요.

1. **교체**: `api/data.php`, `api/image.php`
2. **신규 업로드**: `api/admin.php`, `api/archive.php`
3. **`api/config.php`에 두 줄 추가** (기존 줄은 그대로 두세요)

   ```php
   'ADMIN_TOKEN' => '여기에-긴-랜덤-문자열',      // 관리자 화면 비밀번호. SYNC_TOKEN과 다른 값으로!
   'ARCHIVE_DIR' => '/volume1/photo/trip-board', // 여행 사진 원본이 쌓일 기준 폴더
   ```

   토큰 만들기: `php -r 'echo bin2hex(random_bytes(24)), PHP_EOL;'`
   `ADMIN_TOKEN`은 **두 사람이 공유하는 SYNC_TOKEN과 일부러 다른 비밀**입니다 — 앱을 쓰는 것과, 모든 사람이 보는 세션을 바꾸는 것은 다른 권한이니까요.

4. **보관 폴더 권한**: File Station에서 `ARCHIVE_DIR`에 해당하는 폴더를 만들고, Web Station이 도는 사용자(`http`)에게 **쓰기 권한**을 주세요. 하위 폴더 이름은 앱의 관리자 화면에서 정합니다.

**`api/data/`는 손대지 마세요.** 업그레이드 후 첫 요청이 기존 `data.json`과 `photos/`를 `data/sessions/default/` 아래로 한 번 옮깁니다(같은 볼륨 안에서의 이름 바꾸기라 즉시 끝나고, 여러 번 실행해도 안전합니다). 기존 데이터는 그대로 `default` 세션이 됩니다.

### 쓰는 법

- 앱 → 동기화 설정 → 맨 아래 **「관리자」** → `ADMIN_TOKEN` 입력. 비밀번호는 이 기기에 저장되지 않고 탭을 닫으면 잊혀집니다.
- **세션**: 새로 만들고, 「전환」하면 접속한 모든 사람이 그 세션을 보게 됩니다. 세션을 바꿔도 예전 세션 데이터는 서버와 각 기기에 그대로 남아 있어요. **세션 삭제 기능은 없습니다** — 정말 지우려면 File Station에서 `data/sessions/<id>` 폴더를 지우세요.
- **사진 보관함**: 관리자 화면에서 폴더 이름(예: `2026-11-osaka`)을 정하면, 앱 상단의 📤 「사진 보관」이 그 폴더로 원본 사진을 올립니다. 사진은 줄이지 않고 원본 그대로 저장되며, 계획·카드와는 무관합니다.
- 사진 한 장이 크면 NAS의 PHP 설정(`post_max_size`, `upload_max_filesize`)을 올려야 할 수 있습니다 — 초과하면 앱이 그렇게 안내합니다.
- **키 점검** 버튼이 AI 키 · 구글 지도 키 · 보관 폴더 쓰기 권한을 한 번에 ✓/✗로 확인해 줍니다.

## 문제 해결

| 증상 | 확인 |
|---|---|
| 사이트 안 열림 | DNS 전파(nslookup trip.863ad.co.kr), 443 포워딩, 가상 호스트 호스트명 오타 |
| 인증서 경고 | 2단계 인증서가 이 호스트에 할당됐는지 |
| api가 파일로 다운로드됨 | 가상 호스트에 PHP 프로필 미지정 |
| 연결 테스트 실패 | 주소 끝 `/api` 포함 여부, 토큰 복사 오류, `data.php` 직접 열어 unauthorized 확인 |
| 저장 오류(storage_error) | 6단계 권한 |
| AI 상태 「서버에 AI 키가…」 | config.php 키 오타/누락, PHP curl 확장 |
| 관리자 화면이 「서버에 관리자 기능이 없어요」 | `api/admin.php`가 올라갔는지 |
| 관리자 비밀번호가 계속 틀림 | config.php의 `ADMIN_TOKEN`이 기본값(`change-me-…`)이면 서버가 거절합니다 |
| 사진 보관이 「보관할 폴더가…」 | 관리자 화면에서 폴더 이름을 정했는지 |
| 사진 보관이 「보관 폴더에 쓸 수 없어요」 | `ARCHIVE_DIR` 경로·권한 (관리자 화면의 「키 점검」으로 확인) |

앱 업데이트 방법: 새 빌드가 나오면 `web/travel/` 의 앱 파일들(index.html, assets/, sw.js 등)만 교체 — `api/config.php` 와 `api/data/` 는 그대로 두면 됩니다.
