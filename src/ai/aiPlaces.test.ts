import { describe, expect, it } from 'vitest';
import {
  ADDRESS_PROMPT_MARKER,
  MAX_PLACE_ADDRESS,
  MAX_PLACE_CANDIDATES,
  MAX_PLACE_QUERY,
  PLACES_SCHEMA,
  buildAddressPrompt,
  buildPlacesPrompt,
  extractJsonObject,
  parseAddressAnswer,
  parsePlaceAnswer,
  parsePlaceCandidates,
  toGeoPoint,
  type PlaceCandidate,
} from './aiPlaces';

describe('buildPlacesPrompt', () => {
  it('leads with the query so the model knows what is being looked up', () => {
    const prompt = buildPlacesPrompt('츠텐카쿠');
    expect(prompt.startsWith('찾는 장소: 츠텐카쿠')).toBe(true);
  });

  it('carries the trip destination as context — a nickname needs a city', () => {
    const prompt = buildPlacesPrompt('글리코상', '오사카시, 오사카부, 일본');
    expect(prompt).toContain('여행지: 오사카시, 오사카부, 일본');
    expect(prompt).toContain('위 여행지 안에서 먼저 찾아요');
  });

  it('omits the destination line (and its rule) when the trip has none', () => {
    const prompt = buildPlacesPrompt('츠텐카쿠');
    expect(prompt).not.toContain('여행지:');
    expect(prompt).not.toContain('위 여행지 안에서');
  });

  it('trims a blank destination the same way as a missing one', () => {
    expect(buildPlacesPrompt('츠텐카쿠', '   ')).toBe(buildPlacesPrompt('츠텐카쿠'));
  });

  it('asks for the local-language name and real coordinates', () => {
    const prompt = buildPlacesPrompt('통천각');
    expect(prompt).toContain('localName');
    expect(prompt).toContain('通天閣');
    expect(prompt).toContain(`1~${MAX_PLACE_CANDIDATES}개`);
    expect(prompt).toContain('도시 중심 좌표로 대충 채우지 않아요');
  });

  it('caps an absurd query rather than forwarding it whole', () => {
    const prompt = buildPlacesPrompt('가'.repeat(400));
    const first = prompt.split('\n')[0];
    expect(first.length).toBeLessThanOrEqual('찾는 장소: '.length + MAX_PLACE_QUERY);
    expect(first.endsWith('…')).toBe(true);
  });
});

describe('PLACES_SCHEMA', () => {
  it('pins the three fields a pin cannot be built without', () => {
    expect(PLACES_SCHEMA.properties.places.items.required).toEqual(['name', 'lat', 'lng']);
    expect(PLACES_SCHEMA.required).toEqual(['places']);
  });
});

describe('parsePlaceCandidates', () => {
  it('reads a well-formed answer', () => {
    expect(
      parsePlaceCandidates({
        places: [
          { name: '통천각', localName: '通天閣', locality: '오사카', lat: 34.6525, lng: 135.5063 },
        ],
      }),
    ).toEqual([
      { name: '통천각', localName: '通天閣', locality: '오사카', lat: 34.6525, lng: 135.5063 },
    ]);
  });

  it('accepts stringified coordinates — the model sometimes quotes them', () => {
    expect(parsePlaceCandidates({ places: [{ name: 'a', lat: '1.5', lng: '2.5' }] })).toEqual([
      { name: 'a', lat: 1.5, lng: 2.5 },
    ]);
  });

  it('drops rows whose coordinates are out of range', () => {
    const rows = parsePlaceCandidates({
      places: [
        { name: '북극 너머', lat: 91, lng: 0 },
        { name: '남극 아래', lat: -90.5, lng: 0 },
        { name: '동쪽 끝 너머', lat: 0, lng: 181 },
        { name: '서쪽 끝 너머', lat: 0, lng: -180.1 },
        { name: '살아남은 곳', lat: -33.8688, lng: 151.2093 },
      ],
    });
    expect(rows).toEqual([{ name: '살아남은 곳', lat: -33.8688, lng: 151.2093 }]);
  });

  it('drops null island, NaN and non-numeric coordinates', () => {
    expect(
      parsePlaceCandidates({
        places: [
          { name: '빈 좌표', lat: 0, lng: 0 },
          { name: '숫자 아님', lat: 'nope', lng: 135 },
          { name: '무한대', lat: Number.POSITIVE_INFINITY, lng: 135 },
          { name: '좌표 없음' },
        ],
      }),
    ).toEqual([]);
  });

  it('drops rows without a usable name', () => {
    expect(
      parsePlaceCandidates({
        places: [
          { name: '   ', lat: 34.6, lng: 135.5 },
          { name: 42, lat: 34.6, lng: 135.5 },
          null,
          'junk',
        ],
      }),
    ).toEqual([]);
  });

  it('never returns more than the cap', () => {
    const places = Array.from({ length: 12 }, (_, index) => ({
      name: `장소 ${index}`,
      lat: 34 + index / 100,
      lng: 135,
    }));
    expect(parsePlaceCandidates({ places })).toHaveLength(MAX_PLACE_CANDIDATES);
  });

  it('leaves out a local name that only repeats the Korean one', () => {
    const [row] = parsePlaceCandidates({
      places: [{ name: '통천각', localName: '통천각', locality: '', lat: 34.6, lng: 135.5 }],
    });
    expect(row).toEqual({ name: '통천각', lat: 34.6, lng: 135.5 });
  });

  it('treats garbage and empty answers as no candidates', () => {
    expect(parsePlaceCandidates(null)).toEqual([]);
    expect(parsePlaceCandidates('그런 장소는 없어요')).toEqual([]);
    expect(parsePlaceCandidates({ places: {} })).toEqual([]);
    expect(parsePlaceCandidates({ places: [] })).toEqual([]);
  });
});

describe('extractJsonObject', () => {
  it('reads plain JSON', () => {
    expect(extractJsonObject('{"places":[]}')).toEqual({ places: [] });
  });

  it('unwraps a ```json fence', () => {
    expect(extractJsonObject('```json\n{"places":[{"name":"a"}]}\n```')).toEqual({
      places: [{ name: 'a' }],
    });
  });

  it('digs the object out of a sentence around it', () => {
    expect(
      extractJsonObject('찾았어요! {"places":[{"name":"통천각"}]} 이렇게 나왔습니다.'),
    ).toEqual({ places: [{ name: '통천각' }] });
  });

  it('returns null for prose with no JSON in it at all', () => {
    expect(extractJsonObject('그런 장소는 찾지 못했어요')).toBeNull();
    expect(extractJsonObject('   ')).toBeNull();
    expect(extractJsonObject('{ 반쯤 열린 괄호')).toBeNull();
  });
});

describe('parsePlaceAnswer', () => {
  const json = { places: [{ name: '스키마 결과', lat: 34.6, lng: 135.5 }] };

  it('prefers the schema-parsed body', () => {
    expect(parsePlaceAnswer({ text: '무시되는 본문', json, citations: [] })).toEqual([
      { name: '스키마 결과', lat: 34.6, lng: 135.5 },
    ]);
  });

  it('falls back to the text when there is no json (a grounded answer)', () => {
    expect(
      parsePlaceAnswer({
        text: '```json\n{"places":[{"name":"산문 결과","lat":34.7,"lng":135.6}]}\n```',
        citations: [],
      }),
    ).toEqual([{ name: '산문 결과', lat: 34.7, lng: 135.6 }]);
  });

  it('is empty when neither half holds anything usable', () => {
    expect(parsePlaceAnswer({ text: '못 찾았어요', json: { places: [] }, citations: [] })).toEqual(
      [],
    );
  });
});

/* ------------------------------------------------------------------ *
 * 주소 되묻기 (M37)
 * ------------------------------------------------------------------ */

/** OSM에 없는 작은 체인점 — 이름 스냅이 빗나가는 그 자리. */
const IPPUDO: PlaceCandidate = {
  name: '잇푸도 난바점',
  localName: '一風堂 なんば店',
  locality: '오사카',
  lat: 34.6659,
  lng: 135.5013,
};

describe('buildAddressPrompt', () => {
  it('leads with the marker the mock and the model both key on', () => {
    expect(buildAddressPrompt(IPPUDO).startsWith(`${ADDRESS_PROMPT_MARKER} 一風堂 なんば店`)).toBe(
      true,
    );
  });

  it('asks for an address, in the local script — not for coordinates again', () => {
    const prompt = buildAddressPrompt(IPPUDO);
    expect(prompt).toContain('정식 주소를 현지 표기로');
    expect(prompt).toContain('{"address":"…"}');
    expect(prompt).not.toContain('lat');
  });

  it('carries the Korean name, the locality and the rough position as context', () => {
    const prompt = buildAddressPrompt(IPPUDO);
    expect(prompt).toContain('한국어 표기: 잇푸도 난바점');
    expect(prompt).toContain('지역: 오사카');
    expect(prompt).toContain('대략 위치: 34.6659, 135.5013');
  });

  it('leaves out the lines it has nothing to put on', () => {
    const prompt = buildAddressPrompt({ name: '통천각', lat: 34.65, lng: 135.5 });
    expect(prompt.startsWith(`${ADDRESS_PROMPT_MARKER} 통천각`)).toBe(true);
    expect(prompt).not.toContain('한국어 표기:');
    expect(prompt).not.toContain('지역:');
  });

  it('has nothing to ask about a nameless candidate', () => {
    expect(buildAddressPrompt({ name: '  ', lat: 34.65, lng: 135.5 })).toBe('');
  });

  it('caps an absurd name rather than forwarding it whole', () => {
    const first = buildAddressPrompt({ name: '가'.repeat(400), lat: 34.65, lng: 135.5 }).split(
      '\n',
    )[0];
    expect(first.length).toBeLessThanOrEqual(ADDRESS_PROMPT_MARKER.length + 1 + MAX_PLACE_QUERY);
  });
});

describe('parseAddressAnswer', () => {
  const answer = (text: string, json?: unknown) => ({ text, json, citations: [] });

  it('reads the one-line JSON it asked for', () => {
    expect(parseAddressAnswer(answer('{"address":"大阪府大阪市中央区難波1-4-16"}'))).toBe(
      '大阪府大阪市中央区難波1-4-16',
    );
  });

  it('reads it out of a ```json fence, which grounded answers love', () => {
    expect(
      parseAddressAnswer(answer('```json\n{"address":"大阪府大阪市中央区難波1-4-16"}\n```')),
    ).toBe('大阪府大阪市中央区難波1-4-16');
  });

  it('digs it out of a sentence wrapped around it', () => {
    expect(
      parseAddressAnswer(answer('검색해 보니 {"address":"大阪市中央区難波1-4-16"} 였어요.')),
    ).toBe('大阪市中央区難波1-4-16');
  });

  it('falls back to a bare address line with a label on it', () => {
    expect(parseAddressAnswer(answer('주소: 大阪府大阪市中央区難波1-4-16'))).toBe(
      '大阪府大阪市中央区難波1-4-16',
    );
    expect(parseAddressAnswer(answer('- 「大阪市中央区難波1-4-16」'))).toBe(
      '大阪市中央区難波1-4-16',
    );
  });

  it('skips the chatty first line and takes the address line', () => {
    expect(
      parseAddressAnswer(answer('네, 찾았어요!\n大阪府大阪市中央区難波1-4-16\n영업시간은 별개예요')),
    ).toBe('大阪府大阪市中央区難波1-4-16');
  });

  it('treats a refusal as no address — there is no 번지 in it', () => {
    expect(parseAddressAnswer(answer('{"address":""}'))).toBeNull();
    expect(parseAddressAnswer(answer('확실하지 않아서 알려 드릴 수 없어요'))).toBeNull();
    expect(parseAddressAnswer(answer('{"address":"확실하지 않아요"}'))).toBeNull();
    expect(parseAddressAnswer(answer('   '))).toBeNull();
  });

  it('refuses a paragraph pretending to be an address', () => {
    const essay = `${'설명 '.repeat(60)}1번지`;
    expect(essay.length).toBeGreaterThan(MAX_PLACE_ADDRESS);
    expect(parseAddressAnswer(answer(essay))).toBeNull();
    expect(parseAddressAnswer(answer(JSON.stringify({ address: essay })))).toBeNull();
  });

  it('prefers a schema-parsed body when there somehow is one', () => {
    expect(parseAddressAnswer(answer('무시되는 본문 1', { address: '서울시 중구 세종대로 110' }))).toBe(
      '서울시 중구 세종대로 110',
    );
  });
});

describe('toGeoPoint', () => {
  it('keeps only the three fields the workspace stores', () => {
    const candidate: PlaceCandidate = {
      name: '통천각',
      localName: '通天閣',
      locality: '오사카',
      lat: 34.6525,
      lng: 135.5063,
    };
    expect(toGeoPoint(candidate)).toEqual({
      lat: 34.6525,
      lng: 135.5063,
      address: '통천각, 오사카',
    });
  });

  it('uses the name alone when there is no locality', () => {
    expect(toGeoPoint({ name: '통천각', lat: 34.6525, lng: 135.5063 })).toEqual({
      lat: 34.6525,
      lng: 135.5063,
      address: '통천각',
    });
  });
});
