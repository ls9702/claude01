/**
 * 「주변 맛집」 큐레이션 목록 — **데이터만** (M43).
 *
 * 이 파일에는 로직이 한 줄도 없다. 타입 하나와 배열 하나뿐이고, 그 배열은
 * 사람이 손으로 조사해 적은 것이다. 그래서 조사가 끝나면 배열만 통째로 갈아
 * 끼우면 되고, 그때 다른 파일은 한 글자도 바뀌지 않는다 — 필터도(`gourmet/filter`),
 * 캐시도(`gourmet/cache`), 검색도(`gourmet/nearby`) 이 배열의 내용을 모른다.
 *
 * ## 좌표가 없는 것은 실수가 아니다
 *
 * 여기에는 `lat`/`lng`가 **일부러** 없다. 손으로 적은 좌표는 조사 시점에 한 번
 * 맞고 그 뒤로는 아무도 확인하지 않는다(M35~M37이 그 값을 쫓아다닌 이유다).
 * 대신 앱이 켜질 때 `${localName} ${area}`로 구글 Places에 **한 번** 묻고 그
 * 답을 기기에 캐시한다 — 좌표도, 주소도, 지금의 구글 평점도 그 한 번에서 온다.
 * 그러면 이 파일이 들고 있어야 하는 것은 「어느 가게인가」뿐이다.
 *
 * ## 두 개의 평점
 *
 * `tabelog`은 조사 시점의 **스냅샷**이다(그래서 `surveyedAt`이 함께 있다).
 * 구글 평점은 캐시가 들고 있는 실시간 값이고, 화면은 둘을 나란히 보여 준다.
 * 4.3 미만으로 떨어진 집이 목록에서 사라지는 판정은 **구글 쪽** 값으로만 한다 —
 * 타베로그 점수는 우리가 다시 조사하기 전까지 늙지 않기 때문이다.
 */

/** 다섯 갈래. 필터 칩도, 핀 이모지도, 구글 검색 종류도 이 다섯에서 갈린다. */
export type GourmetGenre = 'sushi' | 'ramen' | 'katsu' | 'okonomiyaki' | 'dessert';

/** 이 여행이 도는 두 도시. 검색을 그 도시 쪽으로 기울이는 데 쓰인다. */
export type GourmetCity = 'osaka' | 'kyoto';

/** 손으로 조사한 한 집. */
export interface GourmetEntry {
  /** 안정적인 슬러그 — 캐시의 키다. 한 번 나간 id는 바꾸지 않는다. */
  id: string;
  /** 화면에 뜨는 한국어 이름. */
  name: string;
  /** 일본어 상호 — 구글에 물을 때 쓰는 진짜 열쇠다. */
  localName: string;
  genre: GourmetGenre;
  city: GourmetCity;
  /** 「도톤보리」·「기온」 — 검색을 좁히는 동네 힌트. */
  area: string;
  /** 조사 시점의 타베로그 점수 스냅샷. */
  tabelog: number;
  /** 예약 가능 여부 (조사값). */
  reservable: boolean;
  /** 한 줄 메모. */
  note?: string;
  /** 조사 시점 `'YYYY-MM'`. */
  surveyedAt: string;
}

/**
 * 2026-08 조사분 — 오사카 72 · 교토 55, 다섯 장르 127곳.
 *
 * 기준: 타베로그 3.3 이상 **그리고** 구글 4.3 이상(구글 쪽은 앱이 실시간
 * 재확인). 주요 관광지 반경 ~10km. 백명점·빕구르망 선정 이력이 확인된 집은
 * 점수의 근거가 그 선정이고, 3.50은 「선정만 확인, 정확 점수 미확보」 표기다.
 * 다음 조사 때 이 배열만 통째로 갈아 끼운다.
 */
export const GOURMET_ENTRIES: readonly GourmetEntry[] = [
  { id: 'harukoma-honten', name: '하루코마 본점', localName: '春駒 本店', genre: 'sushi', city: 'osaka', area: '우메다', tabelog: 3.71, reservable: false, note: '덴마 명물 초밥. 개점 전부터 줄서기 필수', surveyedAt: '2026-08' },
  { id: 'harukoma-shiten', name: '하루코마 지점', localName: '春駒 支店', genre: 'sushi', city: 'osaka', area: '우메다', tabelog: 3.60, reservable: false, note: '본점 대기 길면 이쪽으로. 네타 크기 동일', surveyedAt: '2026-08' },
  { id: 'daiki-suisan-dotonbori', name: '다이키수산 회전초밥 도톤보리점', localName: '大起水産回転寿司 道頓堀店', genre: 'sushi', city: 'osaka', area: '도톤보리', tabelog: 3.42, reservable: false, note: '가성비 회전초밥. 참다랑어 해체쇼가 명물', surveyedAt: '2026-08' },
  { id: 'yoshinozushi', name: '요시노즈시', localName: '吉野鯗', genre: 'sushi', city: 'osaka', area: '우메다', tabelog: 3.62, reservable: true, note: '1841년 창업, 오사카 하코즈시의 원조', surveyedAt: '2026-08' },
  { id: 'sushi-sumiya-namba', name: '스미야', localName: '鮨 墨や', genre: 'sushi', city: 'osaka', area: '난바', tabelog: 3.50, reservable: true, note: '타베로그 스시 백명점. 오마카세 예약 필수', surveyedAt: '2026-08' },
  { id: 'takahashi-kentaro', name: '다카하시 겐타로', localName: '髙橋 謙太郎', genre: 'sushi', city: 'osaka', area: '우메다', tabelog: 3.50, reservable: true, note: '기타하마 백명점 스시야. 카운터 오마카세', surveyedAt: '2026-08' },
  { id: 'matsuzushi-kitabatake', name: '마츠즈시', localName: '松寿司', genre: 'sushi', city: 'osaka', area: '텐노지', tabelog: 3.50, reservable: true, note: '기타바타케의 백명점. 조용한 노포 스시야', surveyedAt: '2026-08' },
  { id: 'endo-sushi-chuoichiba', name: '엔도스시 중앙시장점', localName: 'ゑんどう寿司 中央市場店', genre: 'sushi', city: 'osaka', area: '우메다', tabelog: 3.55, reservable: false, note: '시장 안 아침 초밥. 5알 세트, 오후 문 닫음', surveyedAt: '2026-08' },
  { id: 'maguroya-kurogin', name: '마구로야 쿠로긴', localName: 'まぐろや 黒銀', genre: 'sushi', city: 'osaka', area: '난바', tabelog: 3.45, reservable: false, note: '구로몬시장 참치 전문. 서서 먹는 카이센동도', surveyedAt: '2026-08' },
  { id: 'kuromon-sanpei', name: '쿠로몬 산페이', localName: '黒門三平', genre: 'sushi', city: 'osaka', area: '난바', tabelog: 3.36, reservable: false, note: '구로몬시장 대표 선어점. 2층 취식 공간 있음', surveyedAt: '2026-08' },
  { id: 'daiki-suisan-kuromon', name: '다이키수산 회전초밥 구로몬시장점', localName: '大起水産回転寿司 黒門市場店', genre: 'sushi', city: 'osaka', area: '난바', tabelog: 3.38, reservable: false, note: '구로몬시장 안 회전초밥. 도톤보리보다 한산', surveyedAt: '2026-08' },
  { id: 'ichiran-dotonbori-honkan', name: '이치란 도톤보리점 본관', localName: '一蘭 道頓堀店本館', genre: 'ramen', city: 'osaka', area: '도톤보리', tabelog: 3.40, reservable: false, note: '24시간 영업. 본관이 원조, 야간에도 줄', surveyedAt: '2026-08' },
  { id: 'kinguemon-dotonbori', name: '킨구에몬 도톤보리점', localName: '金久右衛門 道頓堀店', genre: 'ramen', city: 'osaka', area: '도톤보리', tabelog: 3.55, reservable: false, note: '오사카 흑간장 라멘. 오사카 블랙 추천', surveyedAt: '2026-08' },
  { id: 'kamukura-dotonbori', name: '카무쿠라 도톤보리점', localName: 'どうとんぼり神座 道頓堀店', genre: 'ramen', city: 'osaka', area: '도톤보리', tabelog: 3.50, reservable: false, note: '배추 듬뿍 오이시이라멘. 해장으로 인기', surveyedAt: '2026-08' },
  { id: 'chukasoba-fujii', name: '츄카소바 후지이', localName: '中華そば ふじい', genre: 'ramen', city: 'osaka', area: '도톤보리', tabelog: 3.55, reservable: false, note: '맑은 간장 츄카소바. 점심만 여는 날 많음', surveyedAt: '2026-08' },
  { id: 'osaka-mentetsu', name: '오사카 멘테츠', localName: '大阪 麺哲', genre: 'ramen', city: 'osaka', area: '우메다', tabelog: 3.68, reservable: false, note: '백명점 6년 연속. 심플한 간장라멘의 교과서', surveyedAt: '2026-08' },
  { id: 'jinrui-mina-menrui', name: '진루이미나멘루이', localName: '人類みな麺類', genre: 'ramen', city: 'osaka', area: '우메다', tabelog: 3.72, reservable: false, note: '니시나카지마 행렬점. 마이크로 돼지 차슈', surveyedAt: '2026-08' },
  { id: 'mugi-to-mensuke', name: '무기토멘스케', localName: '麦と麺助', genre: 'ramen', city: 'osaka', area: '우메다', tabelog: 3.75, reservable: false, note: '나카츠 백명점. 오리+정어리 육수가 일품', surveyedAt: '2026-08' },
  { id: 'moeyo-mensuke', name: '모에요멘스케', localName: '燃えよ 麺助', genre: 'ramen', city: 'osaka', area: '우메다', tabelog: 3.78, reservable: false, note: '후쿠시마 백명점. 기슈 오리 중화소바 강추', surveyedAt: '2026-08' },
  { id: 'resshi-shoyu-sanku', name: '산쿠 (렛시쇼유 멘코보)', localName: '烈志笑魚油 麺香房 三く', genre: 'ramen', city: 'osaka', area: '우메다', tabelog: 3.70, reservable: false, note: '신후쿠시마 백명점. 니보시 라멘 진한 맛', surveyedAt: '2026-08' },
  { id: 'mitsuboshi-seimenjo-sonezaki', name: '미츠보시제면소 소네자키본점', localName: 'みつ星製麺所 曽根崎本店', genre: 'ramen', city: 'osaka', area: '우메다', tabelog: 3.58, reservable: false, note: '진한 어개계 츠케멘. 우메다 심야에도 OK', surveyedAt: '2026-08' },
  { id: 'ramen-yashichi', name: '라멘 야시치', localName: 'らーめん 弥七', genre: 'ramen', city: 'osaka', area: '우메다', tabelog: 3.65, reservable: false, note: '백명점. 조개 육수 시오라멘이 시그니처', surveyedAt: '2026-08' },
  { id: 'kadoya-shokudo-sohonten', name: '카도야식당 총본점', localName: 'カドヤ食堂 総本店', genre: 'ramen', city: 'osaka', area: '신사이바시', tabelog: 3.72, reservable: false, note: '신마치 백명점. 간장 중화소바의 명가', surveyedAt: '2026-08' },
  { id: 'menya-joroku', name: '멘야 조로쿠', localName: '麺屋 丈六', genre: 'ramen', city: 'osaka', area: '난바', tabelog: 3.68, reservable: false, note: '센니치마에 백명점. 중화소바+차슈밥 조합', surveyedAt: '2026-08' },
  { id: 'men-no-yoji', name: '멘노요지', localName: '麺のようじ', genre: 'ramen', city: 'osaka', area: '난바', tabelog: 3.60, reservable: false, note: '닛폰바시 백명점. 조개 육수 라멘 추천', surveyedAt: '2026-08' },
  { id: 'raamen-shuki', name: '라멘 슈키', localName: 'らぁめん しゅき', genre: 'ramen', city: 'osaka', area: '텐노지', tabelog: 3.65, reservable: false, note: '츠루하시 백명점. 맑은 시오라멘이 간판', surveyedAt: '2026-08' },
  { id: 'daruma-shinsekai-sohonten', name: '다루마 신세카이 총본점', localName: '元祖串かつ だるま 新世界総本店', genre: 'katsu', city: 'osaka', area: '신세카이', tabelog: 3.50, reservable: false, note: '쿠시카츠 원조 1929년. 소스 두 번 찍기 금지', surveyedAt: '2026-08' },
  { id: 'yaekatsu', name: '야에카츠', localName: '八重勝', genre: 'katsu', city: 'osaka', area: '신세카이', tabelog: 3.62, reservable: false, note: '잔잔요코초 최고 인기. 도테야키도 꼭 주문', surveyedAt: '2026-08' },
  { id: 'kushikatsu-tengu-shinsekai', name: '쿠시카츠 텐구', localName: '串かつ 天狗', genre: 'katsu', city: 'osaka', area: '신세카이', tabelog: 3.42, reservable: false, note: '신세카이 노포. 저렴하고 회전 빠른 편', surveyedAt: '2026-08' },
  { id: 'grill-bon-shinsekai', name: '그릴 봉 신세카이본점', localName: 'グリル梵 新世界本店', genre: 'katsu', city: 'osaka', area: '신세카이', tabelog: 3.68, reservable: true, note: '헤레카츠 샌드가 명물. 포장 예약 추천', surveyedAt: '2026-08' },
  { id: 'matsuba-sohonten', name: '쿠시카츠 마츠바 총본점', localName: '串カツ 松葉 総本店', genre: 'katsu', city: 'osaka', area: '우메다', tabelog: 3.55, reservable: false, note: '신우메다 식도가의 서서 먹는 쿠시카츠', surveyedAt: '2026-08' },
  { id: 'yoneya-umeda-honten', name: '쿠시카츠 요네야 우메다본점', localName: '串かつ ヨネヤ 梅田本店', genre: 'katsu', city: 'osaka', area: '우메다', tabelog: 3.51, reservable: false, note: '우메다 직장인 성지. 도테야키와 생맥주', surveyedAt: '2026-08' },
  { id: 'kushinobo-hozenji', name: '쿠시노보 호젠지본점', localName: '串の坊 法善寺本店', genre: 'katsu', city: 'osaka', area: '도톤보리', tabelog: 3.52, reservable: true, note: '호젠지요코초 고급 쿠시아게. 오마카세 코스', surveyedAt: '2026-08' },
  { id: 'rokkakutei-namba', name: '롯카쿠테이', localName: '六覺燈', genre: 'katsu', city: 'osaka', area: '난바', tabelog: 3.78, reservable: true, note: '고급 쿠시아게 카운터. 예약 필수, 소금 위주', surveyedAt: '2026-08' },
  { id: 'tonkatsu-fujii-senbayashi', name: '톤카츠 후지이', localName: 'とんかつ ふじ井', genre: 'katsu', city: 'osaka', area: '오사카성', tabelog: 3.62, reservable: true, note: '센바야시 백명점. 프렌치 출신 셰프의 돈카츠', surveyedAt: '2026-08' },
  { id: 'tonkatsu-masuiya', name: '톤카츠 마스이야', localName: 'とんかつ ますいや', genre: 'katsu', city: 'osaka', area: '오사카성', tabelog: 3.58, reservable: true, note: '조토구 백명점. 차미톤 등심카츠 정식', surveyedAt: '2026-08' },
  { id: 'tonkatsu-epais-kitashinchi', name: '톤카츠 에페', localName: 'とんかつ エペ', genre: 'katsu', city: 'osaka', area: '우메다', tabelog: 3.62, reservable: true, note: '기타신치 돈카츠 백명점. 저녁은 예약 권장', surveyedAt: '2026-08' },
  { id: 'tonkatsu-genya-higobashi', name: '톤카츠 겐야', localName: 'とんかつ 源屋', genre: 'katsu', city: 'osaka', area: '우메다', tabelog: 3.52, reservable: true, note: '히고바시 브랜드돈 전문. 로스·히레 정식 추천', surveyedAt: '2026-08' },
  { id: 'mizuno-dotonbori', name: '미즈노', localName: 'お好み焼 美津の', genre: 'okonomiyaki', city: 'osaka', area: '도톤보리', tabelog: 3.62, reservable: false, note: '1945년 창업 빕구르망. 야마이모야키가 명물', surveyedAt: '2026-08' },
  { id: 'chibo-dotonbori', name: '치보 도톤보리빌딩점', localName: '千房 道頓堀ビル店', genre: 'okonomiyaki', city: 'osaka', area: '도톤보리', tabelog: 3.35, reservable: true, note: '도톤보리 뷰 좌석. 예약 가능해 대기 없음', surveyedAt: '2026-08' },
  { id: 'kukuru-dotonbori', name: '타코야 도톤보리 쿠쿠루 본점', localName: 'たこ家 道頓堀 くくる 本店', genre: 'okonomiyaki', city: 'osaka', area: '도톤보리', tabelog: 3.40, reservable: false, note: '문어 다리가 튀어나온 빅쿠리 타코야키', surveyedAt: '2026-08' },
  { id: 'juhachiban-dotonbori', name: '타코야키 주하치반 도톤보리점', localName: 'たこ焼き 十八番 道頓堀店', genre: 'okonomiyaki', city: 'osaka', area: '도톤보리', tabelog: 3.42, reservable: false, note: '튀김가루 반죽으로 겉바속촉. 소스 두 종', surveyedAt: '2026-08' },
  { id: 'yukari-sennichimae', name: '유카리 센니치마에본점', localName: 'お好み焼 ゆかり 千日前本店', genre: 'okonomiyaki', city: 'osaka', area: '난바', tabelog: 3.53, reservable: true, note: '1950년대 창업 노포. 예약하면 대기 없음', surveyedAt: '2026-08' },
  { id: 'fukutaro-honten', name: '후쿠타로 본점', localName: 'お好み焼き・鉄板焼 福太郎 本店', genre: 'okonomiyaki', city: 'osaka', area: '난바', tabelog: 3.68, reservable: false, note: '네기야키가 시그니처. 저녁 대기 1시간 각오', surveyedAt: '2026-08' },
  { id: 'ajinoya-namba', name: '아지노야 본점', localName: 'お好み焼 味乃家 本店', genre: 'okonomiyaki', city: 'osaka', area: '난바', tabelog: 3.55, reservable: false, note: '난바 대표 관광 오코노미야키. 믹스 추천', surveyedAt: '2026-08' },
  { id: 'hatsuse-sennichimae', name: '하츠세', localName: 'お好み焼き はつせ', genre: 'okonomiyaki', city: 'osaka', area: '난바', tabelog: 3.45, reservable: true, note: '와규를 쓰는 고급형 오코노미야키. 좌석 넉넉', surveyedAt: '2026-08' },
  { id: 'wanaka-sennichimae', name: '와나카 센니치마에본점', localName: 'たこ焼道楽 わなか 千日前本店', genre: 'okonomiyaki', city: 'osaka', area: '난바', tabelog: 3.55, reservable: false, note: '오사카 타코야키 대표주자. 8알 세트 인기', surveyedAt: '2026-08' },
  { id: 'kougaryu-honten', name: '코가류 본점', localName: '甲賀流 本店', genre: 'okonomiyaki', city: 'osaka', area: '신사이바시', tabelog: 3.48, reservable: false, note: '아메무라 명물. 소스+마요 듬뿍이 시그니처', surveyedAt: '2026-08' },
  { id: 'kiji-umeda-honten', name: '키지 본점', localName: 'お好み焼き きじ 本店', genre: 'okonomiyaki', city: 'osaka', area: '우메다', tabelog: 3.62, reservable: false, note: '신우메다 식도가. 스지모단이 대표 메뉴', surveyedAt: '2026-08' },
  { id: 'hanadako-umeda', name: '하나다코', localName: 'たこ焼き はなだこ', genre: 'okonomiyaki', city: 'osaka', area: '우메다', tabelog: 3.62, reservable: false, note: '우메다 지하 명물. 파 듬뿍 네기마요 필수', surveyedAt: '2026-08' },
  { id: 'negiyaki-yamamoto-honten', name: '네기야키 야마모토 본점', localName: 'ねぎ焼 やまもと 本店', genre: 'okonomiyaki', city: 'osaka', area: '우메다', tabelog: 3.62, reservable: true, note: '네기야키 원조. 스지네기야키에 레몬 곁들임', surveyedAt: '2026-08' },
  { id: 'aizuya-umeda', name: '아이즈야 우메다점', localName: '会津屋 梅田店', genre: 'okonomiyaki', city: 'osaka', area: '우메다', tabelog: 3.45, reservable: false, note: '라디오야키 원조. 소스 없이 먹는 타코야키', surveyedAt: '2026-08' },
  { id: 'yamachan-abeno-honten', name: '아베노 타코야키 야마짱 본점', localName: 'あべのたこやき やまちゃん 本店', genre: 'okonomiyaki', city: 'osaka', area: '텐노지', tabelog: 3.61, reservable: false, note: '반죽 자체가 맛있어 소스 없이도 OK', surveyedAt: '2026-08' },
  { id: 'okonomiyaki-omoni-tsuruhashi', name: '오코노미야키 오모니', localName: 'お好み焼 オモニ', genre: 'okonomiyaki', city: 'osaka', area: '텐노지', tabelog: 3.60, reservable: false, note: '츠루하시 코리아타운 명물. 대기 길어 이른 방문', surveyedAt: '2026-08' },
  { id: 'rikuro-namba-honten', name: '리쿠로 아저씨 난바본점', localName: 'りくろーおじさんの店 なんば本店', genre: 'dessert', city: 'osaka', area: '난바', tabelog: 3.58, reservable: false, note: '갓 구운 치즈케이크. 2층 카페에서 따뜻하게', surveyedAt: '2026-08' },
  { id: 'arabiya-coffee', name: '아라비야 커피', localName: 'アラビヤコーヒー', genre: 'dessert', city: 'osaka', area: '난바', tabelog: 3.55, reservable: false, note: '1951년 창업 킷사텐. 핫케이크와 블렌드', surveyedAt: '2026-08' },
  { id: 'marufuku-sennichimae', name: '마루후쿠 커피점 센니치마에본점', localName: '丸福珈琲店 千日前本店', genre: 'dessert', city: 'osaka', area: '난바', tabelog: 3.55, reservable: false, note: '1934년 창업. 진한 커피와 핫케이크 세트', surveyedAt: '2026-08' },
  { id: 'junkissa-american', name: '준킷사 아메리칸', localName: '純喫茶アメリカン', genre: 'dessert', city: 'osaka', area: '도톤보리', tabelog: 3.52, reservable: false, note: '쇼와 레트로 끝판왕. 두꺼운 핫케이크 명물', surveyedAt: '2026-08' },
  { id: 'kissa-madura', name: '킷사 마즈라', localName: '喫茶マヅラ', genre: 'dessert', city: 'osaka', area: '우메다', tabelog: 3.48, reservable: false, note: '오사카역 지하 우주선 인테리어 노포 카페', surveyedAt: '2026-08' },
  { id: 'mon-cher-dojima', name: '몽셰르 도지마본점', localName: 'モンシェール 堂島本店', genre: 'dessert', city: 'osaka', area: '우메다', tabelog: 3.45, reservable: false, note: '도지마롤 원조. 하루 한정 수량 판매', surveyedAt: '2026-08' },
  { id: 'gokan-kitahama', name: '고칸 기타하마본관', localName: 'パティスリー GOKAN 五感 北浜本館', genre: 'dessert', city: 'osaka', area: '우메다', tabelog: 3.60, reservable: false, note: '레트로 건축 안 살롱. 오코메노슈크림 추천', surveyedAt: '2026-08' },
  { id: 'kitahama-retro', name: '기타하마 레트로', localName: '北浜レトロ', genre: 'dessert', city: 'osaka', area: '우메다', tabelog: 3.55, reservable: true, note: '강변 영국식 애프터눈티. 주말은 예약 권장', surveyedAt: '2026-08' },
  { id: 'brooklyn-roasting-kitahama', name: '브루클린 로스팅 컴퍼니 기타하마', localName: 'BROOKLYN ROASTING COMPANY 北浜', genre: 'dessert', city: 'osaka', area: '우메다', tabelog: 3.50, reservable: false, note: '강변 테라스 스페셜티 커피. 아침에 좋음', surveyedAt: '2026-08' },
  { id: 'ravilleie', name: '라비르리에', localName: 'パティスリー ラヴィルリエ', genre: 'dessert', city: 'osaka', area: '신사이바시', tabelog: 3.72, reservable: false, note: '타니로쿠 인기 파티스리. 오전 방문 추천', surveyedAt: '2026-08' },
  { id: 'lilo-coffee-roasters', name: '리로 커피 로스터스', localName: 'LiLo Coffee Roasters', genre: 'dessert', city: 'osaka', area: '신사이바시', tabelog: 3.50, reservable: false, note: '아메무라 스페셜티 커피. 원두 선물용으로도', surveyedAt: '2026-08' },
  { id: 'elk-shinsaibashi', name: '엘크 심사이바시본점', localName: 'Elk 心斎橋本店', genre: 'dessert', city: 'osaka', area: '신사이바시', tabelog: 3.48, reservable: false, note: '두툼한 수플레 팬케이크. 주말 대기 있음', surveyedAt: '2026-08' },
  { id: 'kissa-doremi', name: '킷사 도레미', localName: '喫茶 ドレミ', genre: 'dessert', city: 'osaka', area: '신세카이', tabelog: 3.45, reservable: false, note: '츠텐카쿠 옆 노포. 푸딩과 크림소다가 명물', surveyedAt: '2026-08' },
  { id: 'micasadeco-namba', name: '미카사데코 앤 카페 난바본점', localName: 'Micasadeco&Cafe 難波本店', genre: 'dessert', city: 'osaka', area: '난바', tabelog: 3.50, reservable: false, note: '리코타 팬케이크로 유명. 주말 오픈런 권장', surveyedAt: '2026-08' },
  { id: 'northshore-kitahama', name: '노스쇼어 기타하마', localName: 'NORTHSHORE 北浜', genre: 'dessert', city: 'osaka', area: '우메다', tabelog: 3.50, reservable: false, note: '과일 샌드와 스무디. 강변 뷰 브런치 카페', surveyedAt: '2026-08' },
  { id: 'le-sucre-coeur', name: '르 슈크레 쾨르', localName: 'ル・シュクレクール', genre: 'dessert', city: 'osaka', area: '우메다', tabelog: 3.60, reservable: false, note: '후쿠시마 인기 불랑제리. 오후엔 품절 잦음', surveyedAt: '2026-08' },
  { id: 'takamura-coffee-roasters', name: '타카무라 와인 앤 커피 로스터즈', localName: 'TAKAMURA Wine & Coffee Roasters', genre: 'dessert', city: 'osaka', area: '신사이바시', tabelog: 3.55, reservable: false, note: '창고형 로스터리 카페. 원두 쇼핑도 함께', surveyedAt: '2026-08' },
  { id: 'daiwa-kaen-kuromon', name: '다이와 과수원 구로몬본점', localName: 'ダイワ果園 黒門本店', genre: 'dessert', city: 'osaka', area: '난바', tabelog: 3.40, reservable: false, note: '구로몬시장 과일 샌드·생과일 주스', surveyedAt: '2026-08' },
  { id: 'izuu-gion', name: '이즈우', localName: 'いづう', genre: 'sushi', city: 'kyoto', area: '기온', tabelog: 3.72, reservable: true, note: '1781년 창업 사바즈시 원조. 빕구르망', surveyedAt: '2026-08' },
  { id: 'izuju-gion', name: '이즈주', localName: 'いづ重', genre: 'sushi', city: 'kyoto', area: '기온', tabelog: 3.55, reservable: false, note: '야사카신사 앞 교즈시. 사바즈시·이나리 세트', surveyedAt: '2026-08' },
  { id: 'chidoritei-gion', name: '치도리테이', localName: '千登利亭', genre: 'sushi', city: 'kyoto', area: '기온', tabelog: 3.50, reservable: false, note: '고고에 있는 교즈시 노포. 점심 세트 가성비', surveyedAt: '2026-08' },
  { id: 'otowa-gion', name: '오토와', localName: '乙羽', genre: 'sushi', city: 'kyoto', area: '기온', tabelog: 3.45, reservable: false, note: '기온 뒷골목 교즈시. 하코즈시·사바즈시 추천', surveyedAt: '2026-08' },
  { id: 'sushi-matsumoto-gion', name: '스시 마츠모토', localName: '鮨 まつもと', genre: 'sushi', city: 'kyoto', area: '기온', tabelog: 4.10, reservable: true, note: '미쉐린 스시야. 수개월 전 예약 필수', surveyedAt: '2026-08' },
  { id: 'sakai-nishiki', name: '사카이', localName: 'さか井', genre: 'sushi', city: 'kyoto', area: '니시키시장', tabelog: 3.48, reservable: false, note: '1954년 창업. 사바즈시와 아나고동이 인기', surveyedAt: '2026-08' },
  { id: 'hisagozushi-kawaramachi', name: '히사고즈시 시조가와라마치본점', localName: 'ひさご寿し 四条河原町本店', genre: 'sushi', city: 'kyoto', area: '가와라마치', tabelog: 3.42, reservable: true, note: '교즈시 노포. 무시즈시(겨울 한정)가 별미', surveyedAt: '2026-08' },
  { id: 'sushi-no-musashi-sanjo', name: '스시노 무사시 산조본점', localName: '京 寿司のむさし 三条本店', genre: 'sushi', city: 'kyoto', area: '가와라마치', tabelog: 3.40, reservable: false, note: '가와라마치 회전초밥. 저렴하고 회전 빠름', surveyedAt: '2026-08' },
  { id: 'hanaore-shimogamo', name: '하나오레 시모가모점', localName: '花折 下鴨店', genre: 'sushi', city: 'kyoto', area: '가와라마치', tabelog: 3.50, reservable: true, note: '사바즈시 명가. 매장 식사·포장 모두 가능', surveyedAt: '2026-08' },
  { id: 'honke-daiichiasahi-takabashi', name: '혼케 다이이치아사히 타카바시본점', localName: '本家 第一旭 たかばし本店', genre: 'ramen', city: 'kyoto', area: '교토역', tabelog: 3.72, reservable: false, note: '교토역 도보권 백명점. 아침부터 줄서기', surveyedAt: '2026-08' },
  { id: 'shinpuku-saikan-honten', name: '신푸쿠사이칸 본점', localName: '新福菜館 本店', genre: 'ramen', city: 'kyoto', area: '교토역', tabelog: 3.68, reservable: false, note: '새까만 간장 라멘. 야키메시도 꼭 같이', surveyedAt: '2026-08' },
  { id: 'yamazaki-menjiro', name: '야마자키 멘지로', localName: '山崎麺二郎', genre: 'ramen', city: 'kyoto', area: '교토역', tabelog: 3.68, reservable: false, note: '엔마치 백명점. 맑은 시오라멘, 재료 소진 마감', surveyedAt: '2026-08' },
  { id: 'rakunijin', name: '라멘 라쿠니진', localName: '拉麺 洛二神', genre: 'ramen', city: 'kyoto', area: '교토역', tabelog: 3.58, reservable: false, note: '도지 근처 어개계 진한 라멘. 츠케멘도 좋음', surveyedAt: '2026-08' },
  { id: 'menya-inoichi', name: '멘야 이노이치', localName: '麺屋 猪一', genre: 'ramen', city: 'kyoto', area: '가와라마치', tabelog: 3.78, reservable: false, note: '백명점. 가다랑어 다시 간장라멘, 대기 김', surveyedAt: '2026-08' },
  { id: 'menya-gokkei', name: '멘야 고쿠케이', localName: '麺屋 極鶏', genre: 'ramen', city: 'kyoto', area: '가와라마치', tabelog: 3.72, reservable: false, note: '이치조지 백명점. 걸쭉한 토리다쿠가 명물', surveyedAt: '2026-08' },
  { id: 'seaburano-kami-mibu', name: '세아부라노카미 미부본점', localName: 'セアブラノ神 壬生本店', genre: 'ramen', city: 'kyoto', area: '가와라마치', tabelog: 3.62, reservable: false, note: '시조오미야 백명점. 등지방 간장라멘', surveyedAt: '2026-08' },
  { id: 'touhichi', name: '라멘 토우히치', localName: 'らぁ麺 とうひち', genre: 'ramen', city: 'kyoto', area: '가와라마치', tabelog: 3.70, reservable: false, note: '기타노 백명점. 닭 육수 시오라멘 정갈', surveyedAt: '2026-08' },
  { id: 'masutani-kitashirakawa', name: '마스타니 기타시라카와본점', localName: 'ますたに 北白川本店', genre: 'ramen', city: 'kyoto', area: '가와라마치', tabelog: 3.58, reservable: false, note: '교토 배부 계열 원조. 등지방 간장라멘', surveyedAt: '2026-08' },
  { id: 'takayasu-ichijoji', name: '츄카소바 타카야스', localName: '中華そば 高安', genre: 'ramen', city: 'kyoto', area: '가와라마치', tabelog: 3.60, reservable: false, note: '이치조지 라멘거리. 거대 가라아게가 명물', surveyedAt: '2026-08' },
  { id: 'tenkaippin-sohonten', name: '텐카잇핑 총본점', localName: '天下一品 総本店', genre: 'ramen', city: 'kyoto', area: '가와라마치', tabelog: 3.55, reservable: false, note: '코테리 라멘 총본점. 본점 한정 메뉴 있음', surveyedAt: '2026-08' },
  { id: 'menbakaichidai', name: '멘바카 이치다이', localName: 'めん馬鹿一代', genre: 'ramen', city: 'kyoto', area: '가와라마치', tabelog: 3.50, reservable: false, note: '불쇼 네기라멘. 예약 없이 대기, 사진 명소', surveyedAt: '2026-08' },
  { id: 'ramen-fuji-fushimi', name: '라멘 후지 본점', localName: 'らーめん 藤 本店', genre: 'ramen', city: 'kyoto', area: '후시미이나리', tabelog: 3.50, reservable: false, note: '후시미 로컬 라멘. 이나리 참배 후 들르기 좋음', surveyedAt: '2026-08' },
  { id: 'katsukura-sanjo-honten', name: '카츠쿠라 산조본점', localName: '名代とんかつ かつくら 三条本店', genre: 'katsu', city: 'kyoto', area: '가와라마치', tabelog: 3.52, reservable: true, note: '교토 돈카츠 대표. 밥·양배추 리필 무료', surveyedAt: '2026-08' },
  { id: 'karasemitei', name: '카라세미테이', localName: '空蝉亭', genre: 'katsu', city: 'kyoto', area: '가와라마치', tabelog: 3.62, reservable: true, note: '숙성돈 돈카츠 백명점·빕구르망. 예약 권장', surveyedAt: '2026-08' },
  { id: 'kyoto-katsugyu-pontocho', name: '교토카츠규 폰토초본점', localName: '牛カツ京都勝牛 先斗町本店', genre: 'katsu', city: 'kyoto', area: '가와라마치', tabelog: 3.45, reservable: false, note: '규카츠 본점. 60초 레어 튀김, 와사비 소금', surveyedAt: '2026-08' },
  { id: 'yoshoku-mishina', name: '요쇼쿠 미시나', localName: '洋食の店 みしな', genre: 'katsu', city: 'kyoto', area: '가와라마치', tabelog: 3.60, reservable: false, note: '구마노신사 앞 양식 노포. 비프카츠가 간판', surveyedAt: '2026-08' },
  { id: 'kitchen-gon-nishijin', name: '키친 곤 니시진점', localName: 'キッチンゴン 西陣店', genre: 'katsu', city: 'kyoto', area: '가와라마치', tabelog: 3.50, reservable: false, note: '교토 명물 피네라이스. 커틀릿+볶음밥 조합', surveyedAt: '2026-08' },
  { id: 'issen-yoshoku-gion', name: '잇센요쇼쿠 기온본점', localName: '壹銭洋食 祇園本店', genre: 'okonomiyaki', city: 'kyoto', area: '기온', tabelog: 3.50, reservable: false, note: '오코노미야키 백명점. 단일 메뉴, 레트로 내부', surveyedAt: '2026-08' },
  { id: 'hidetako-gion', name: '히데타코', localName: '秀蛸', genre: 'okonomiyaki', city: 'kyoto', area: '기온', tabelog: 3.40, reservable: false, note: '하나미코지 타코야키. 카운터에서 굽는 모습', surveyedAt: '2026-08' },
  { id: 'hanatanuki-kawaramachi', name: '하나타누키 가와라마치점', localName: '花たぬき 河原町店', genre: 'okonomiyaki', city: 'kyoto', area: '가와라마치', tabelog: 3.45, reservable: false, note: '교토식 베타야키. 명물 타누키야키 추천', surveyedAt: '2026-08' },
  { id: 'okonomiyaki-jumbo', name: '오코노미야키 잠보', localName: 'お好み焼 ジャンボ', genre: 'okonomiyaki', city: 'kyoto', area: '가와라마치', tabelog: 3.50, reservable: false, note: '토지인 근처 초대형 사이즈. 둘이서 하나면 충분', surveyedAt: '2026-08' },
  { id: 'shitamachi-okonomiyaki-masa', name: '시타마치 오코노미야키 마사', localName: '下町のお好み焼き 昌', genre: 'okonomiyaki', city: 'kyoto', area: '가와라마치', tabelog: 3.45, reservable: false, note: '교토 베타야키 전문. 얇고 바삭한 스타일', surveyedAt: '2026-08' },
  { id: 'kyochabana-kyotoekimae', name: '쿄챠바나 교토역앞점', localName: '京ちゃばな 京都駅前店', genre: 'okonomiyaki', city: 'kyoto', area: '교토역', tabelog: 3.32, reservable: true, note: '토마토 오코노미야키. 교토역 도보권, 예약 가능', surveyedAt: '2026-08' },
  { id: 'tsujiri-gion-honten', name: '사료 츠지리 기온본점', localName: '茶寮都路里 祇園本店', genre: 'dessert', city: 'kyoto', area: '기온', tabelog: 3.55, reservable: false, note: '말차 파르페의 대명사. 오픈 직후가 대기 짧음', surveyedAt: '2026-08' },
  { id: 'gion-tokuya', name: '기온 토쿠야', localName: 'ぎおん徳屋', genre: 'dessert', city: 'kyoto', area: '기온', tabelog: 3.62, reservable: false, note: '본와라비모치가 명물. 대기표 받고 산책 추천', surveyedAt: '2026-08' },
  { id: 'gion-komori', name: '기온 코모리', localName: 'ぎをん小森', genre: 'dessert', city: 'kyoto', area: '기온', tabelog: 3.62, reservable: false, note: '시라카와 강가 찻집. 말차 파르페와 안미츠', surveyedAt: '2026-08' },
  { id: 'muge-sanbo-salon', name: '무게산보 살롱 드 무게', localName: '無碍山房 Salon de Muge', genre: 'dessert', city: 'kyoto', area: '기요미즈', tabelog: 3.68, reservable: true, note: '기쿠노이의 디저트 살롱. 정원 뷰, 예약 권장', surveyedAt: '2026-08' },
  { id: 'kasagiya-ninenzaka', name: '카사기야', localName: 'かさぎ屋', genre: 'dessert', city: 'kyoto', area: '기요미즈', tabelog: 3.55, reservable: false, note: '1914년 창업 니넨자카 단팥집. 젠자이 추천', surveyedAt: '2026-08' },
  { id: 'arabica-higashiyama', name: '아라비카 교토 히가시야마', localName: '% ARABICA 京都 東山', genre: 'dessert', city: 'kyoto', area: '기요미즈', tabelog: 3.55, reservable: false, note: '야사카탑 뷰 라떼. 아침 일찍이 한산', surveyedAt: '2026-08' },
  { id: 'arabica-arashiyama', name: '아라비카 교토 아라시야마', localName: '% ARABICA 京都 嵐山', genre: 'dessert', city: 'kyoto', area: '아라시야마', tabelog: 3.58, reservable: false, note: '가츠라강 뷰 커피. 도게츠교 바로 앞', surveyedAt: '2026-08' },
  { id: 'ex-cafe-arashiyama', name: 'eX카페 교토아라시야마본점', localName: 'eX cafe 京都嵐山本店', genre: 'dessert', city: 'kyoto', area: '아라시야마', tabelog: 3.45, reservable: true, note: '정원 딸린 고민가 카페. 직접 굽는 당고 세트', surveyedAt: '2026-08' },
  { id: 'oimatsu-arashiyama', name: '오이마츠 아라시야마점', localName: '老松 嵐山店', genre: 'dessert', city: 'kyoto', area: '아라시야마', tabelog: 3.50, reservable: false, note: '노포 화과자점. 여름 한정 유즈 젤리가 명물', surveyedAt: '2026-08' },
  { id: 'inoda-coffee-honten', name: '이노다 커피 본점', localName: 'イノダコーヒ 本店', genre: 'dessert', city: 'kyoto', area: '니시키시장', tabelog: 3.62, reservable: false, note: '1940년 창업 교토 커피의 상징. 아침 세트', surveyedAt: '2026-08' },
  { id: 'konnamonja-nishiki', name: '콘나몬쟈 니시키점', localName: 'こんなもんじゃ 錦店', genre: 'dessert', city: 'kyoto', area: '니시키시장', tabelog: 3.45, reservable: false, note: '니시키시장 두유 도넛. 걸어가며 먹기 좋음', surveyedAt: '2026-08' },
  { id: 'rokuyosha-chikaten', name: '로쿠요샤 커피점 지하점', localName: '六曜社珈琲店 地下店', genre: 'dessert', city: 'kyoto', area: '가와라마치', tabelog: 3.62, reservable: false, note: '교토 대표 노포 킷사. 명물 수제 도넛', surveyedAt: '2026-08' },
  { id: 'smart-coffee', name: '스마트 커피점', localName: 'スマート珈琲店', genre: 'dessert', city: 'kyoto', area: '가와라마치', tabelog: 3.58, reservable: false, note: '1932년 창업. 핫케이크와 프렌치토스트', surveyedAt: '2026-08' },
  { id: 'kissa-soiree', name: '킷사 소와레', localName: '喫茶ソワレ', genre: 'dessert', city: 'kyoto', area: '가와라마치', tabelog: 3.50, reservable: false, note: '푸른 조명의 레트로 킷사. 젤리 퐁치가 명물', surveyedAt: '2026-08' },
  { id: 'ippodo-kaboku', name: '잇포도차호 킷사실 카보쿠', localName: '一保堂茶舗 喫茶室 嘉木', genre: 'dessert', city: 'kyoto', area: '가와라마치', tabelog: 3.55, reservable: false, note: '1717년 차 노포의 다실. 직접 우려 마시는 체험', surveyedAt: '2026-08' },
  { id: 'demachi-futaba', name: '데마치 후타바', localName: '出町ふたば', genre: 'dessert', city: 'kyoto', area: '가와라마치', tabelog: 3.75, reservable: false, note: '명물 마메모치. 당일 소비 권장, 줄 김', surveyedAt: '2026-08' },
  { id: 'mangetsu-ajarimochi', name: '만게츠 본점 (아자리모치)', localName: '阿闍梨餅本舗 京菓子司 満月 本店', genre: 'dessert', city: 'kyoto', area: '가와라마치', tabelog: 3.60, reservable: false, note: '아자리모치 본점. 기념품용 대량 구매 가능', surveyedAt: '2026-08' },
  { id: 'walden-woods-kyoto', name: '월든 우즈 교토', localName: 'Walden Woods Kyoto', genre: 'dessert', city: 'kyoto', area: '교토역', tabelog: 3.50, reservable: false, note: '카페 백명점. 새하얀 인테리어가 포토스팟', surveyedAt: '2026-08' },
  { id: 'ogawa-coffee-kyotoeki', name: '오가와 커피 교토역점', localName: '小川珈琲 京都駅店', genre: 'dessert', city: 'kyoto', area: '교토역', tabelog: 3.50, reservable: false, note: '카페 백명점. 교토역 근처, 모닝 세트 좋음', surveyedAt: '2026-08' },
  { id: 'inari-saryo', name: '이나리 사료', localName: '稲荷茶寮', genre: 'dessert', city: 'kyoto', area: '후시미이나리', tabelog: 3.40, reservable: false, note: '이나리 참배길 찻집. 여우 모나카 파르페', surveyedAt: '2026-08' },
  { id: 'vermillion-cafe', name: '버밀리언 카페', localName: 'Vermillion cafe', genre: 'dessert', city: 'kyoto', area: '후시미이나리', tabelog: 3.45, reservable: false, note: '연못 뷰 테라스 카페. 참배 후 휴식용', surveyedAt: '2026-08' },
  { id: 'marumochiya-fushimiinari', name: '마루모치야 후시미이나리본점', localName: 'まるもち家 伏見稲荷本店', genre: 'dessert', city: 'kyoto', area: '후시미이나리', tabelog: 3.35, reservable: false, note: '미즈마루모치가 시그니처. 역에서 도보 1분', surveyedAt: '2026-08' },
];
