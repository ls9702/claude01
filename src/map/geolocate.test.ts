import { describe, expect, it } from 'vitest';
import {
  GEO_DENIED_MESSAGE,
  GEO_TIMEOUT_MESSAGE,
  GEO_UNAVAILABLE_MESSAGE,
  GEO_UNSUPPORTED_MESSAGE,
  geoErrorMessage,
  geoOn,
  geoReduce,
  geoWatching,
  initialGeoState,
  type GeoEvent,
  type GeoState,
} from './geolocate';

const FIX = { lat: 34.6659, lng: 135.5013, accuracyM: 25 };
const OTHER_FIX = { lat: 34.667, lng: 135.502, accuracyM: 12 };

/** 사건들을 차례로 흘려보낸다. */
const run = (events: GeoEvent[], from: GeoState = initialGeoState): GeoState =>
  events.reduce(geoReduce, from);

describe('geoErrorMessage', () => {
  it('세 가지 실패를 각각 한 줄로', () => {
    expect(geoErrorMessage(1)).toBe(GEO_DENIED_MESSAGE);
    expect(geoErrorMessage(2)).toBe(GEO_UNAVAILABLE_MESSAGE);
    expect(geoErrorMessage(3)).toBe(GEO_TIMEOUT_MESSAGE);
  });

  it('모르는 코드는 「찾을 수 없어요」로 접힌다', () => {
    expect(geoErrorMessage(99)).toBe(GEO_UNAVAILABLE_MESSAGE);
  });
});

describe('geoReduce — 켜고 끄기', () => {
  it('처음 누르면 찾는 중이 되고 브라우저를 붙잡는다', () => {
    const state = run([{ kind: 'start' }]);
    expect(state.status).toBe('locating');
    expect(geoOn(state)).toBe(true);
    expect(geoWatching(state)).toBe(true);
    expect(state.session).toBe(1);
  });

  it('좌표가 오면 점이 서고 안내는 사라진다', () => {
    const state = run([{ kind: 'start' }, { kind: 'fix', fix: FIX }]);
    expect(state.status).toBe('active');
    expect(state.fix).toEqual(FIX);
    expect(state.message).toBeNull();
  });

  it('두 번째 좌표는 세션을 바꾸지 않는다 — 지도는 한 번만 따라간다', () => {
    const state = run([{ kind: 'start' }, { kind: 'fix', fix: FIX }, { kind: 'fix', fix: OTHER_FIX }]);
    expect(state.fix).toEqual(OTHER_FIX);
    expect(state.session).toBe(1);
  });

  it('다시 누르면 점도 감시도 사라진다', () => {
    const state = run([{ kind: 'start' }, { kind: 'fix', fix: FIX }, { kind: 'toggle' }]);
    expect(state.status).toBe('off');
    expect(state.fix).toBeNull();
    expect(geoWatching(state)).toBe(false);
  });

  it('꺼진 뒤 다시 켜면 세션이 하나 늘어 지도가 다시 따라간다', () => {
    const state = run([{ kind: 'start' }, { kind: 'fix', fix: FIX }, { kind: 'stop' }, { kind: 'start' }]);
    expect(state.session).toBe(2);
    expect(state.status).toBe('locating');
  });

  it('켜져 있을 때 start를 또 받아도 아무 일도 없다', () => {
    const on = run([{ kind: 'start' }, { kind: 'fix', fix: FIX }]);
    expect(geoReduce(on, { kind: 'start' })).toBe(on);
  });

  it('꺼진 채로 stop을 받으면 상태가 그대로다', () => {
    expect(geoReduce(initialGeoState, { kind: 'stop' })).toBe(initialGeoState);
  });
});

describe('geoReduce — 실패', () => {
  it('거절당하면 한 줄만 남고 점은 서지 않는다', () => {
    const state = run([{ kind: 'start' }, { kind: 'error', code: 1 }]);
    expect(state.status).toBe('error');
    expect(state.message).toBe(GEO_DENIED_MESSAGE);
    expect(state.fix).toBeNull();
    // 실패한 자리에서는 브라우저를 더 붙잡지 않는다.
    expect(geoWatching(state)).toBe(false);
    expect(geoOn(state)).toBe(false);
  });

  it('오류 뒤 한 번 더 누르면 다시 시도한다', () => {
    const state = run([{ kind: 'start' }, { kind: 'error', code: 3 }, { kind: 'toggle' }]);
    expect(state.status).toBe('locating');
    expect(state.message).toBeNull();
    expect(state.session).toBe(2);
  });

  it('꺼진 상태로 늦게 도착한 오류·좌표는 무시된다', () => {
    expect(geoReduce(initialGeoState, { kind: 'error', code: 1 })).toBe(initialGeoState);
    expect(geoReduce(initialGeoState, { kind: 'fix', fix: FIX })).toBe(initialGeoState);
  });

  it('오류로 서 있는 동안 늦게 온 좌표는 화면을 되살리지 않는다', () => {
    const failed = run([{ kind: 'start' }, { kind: 'error', code: 1 }]);
    expect(geoReduce(failed, { kind: 'fix', fix: FIX })).toBe(failed);
  });

  it('기능이 없는 브라우저는 그렇다고 말한다', () => {
    const state = run([{ kind: 'start' }, { kind: 'unsupported' }]);
    expect(state.status).toBe('error');
    expect(state.message).toBe(GEO_UNSUPPORTED_MESSAGE);
  });
});

describe('geoReduce — 배터리', () => {
  it('탭이 숨으면 감시만 멈추고 점은 남는다', () => {
    const state = run([{ kind: 'start' }, { kind: 'fix', fix: FIX }, { kind: 'hide' }]);
    expect(state.suspended).toBe(true);
    expect(geoWatching(state)).toBe(false);
    expect(state.fix).toEqual(FIX);
    // 버튼은 여전히 켜진 모양이다 — 사용자가 끈 적이 없으므로.
    expect(geoOn(state)).toBe(true);
  });

  it('돌아오면 다시 감시한다', () => {
    const state = run([{ kind: 'start' }, { kind: 'fix', fix: FIX }, { kind: 'hide' }, { kind: 'show' }]);
    expect(state.suspended).toBe(false);
    expect(geoWatching(state)).toBe(true);
  });

  it('꺼 둔 채로 탭을 오가도 켜지지 않는다', () => {
    const state = run([{ kind: 'hide' }, { kind: 'show' }]);
    expect(state.status).toBe('off');
    expect(geoWatching(state)).toBe(false);
  });

  it('오류로 멈춘 뒤에도 탭을 오가는 것으로는 되살아나지 않는다', () => {
    const state = run([
      { kind: 'start' },
      { kind: 'error', code: 1 },
      { kind: 'hide' },
      { kind: 'show' },
    ]);
    expect(state.status).toBe('error');
    expect(geoWatching(state)).toBe(false);
  });
});
