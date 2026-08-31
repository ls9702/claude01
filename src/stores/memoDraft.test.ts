import { beforeEach, describe, expect, it } from 'vitest';
import type { CardPhoto } from '../types/models';
import {
  clearMemoDraft,
  loadMemoDraft,
  resetMemoDrafts,
  saveMemoDraft,
} from './memoDraft';

const photo = (id: string): CardPhoto => ({ id, w: 10, h: 10, bytes: 100, createdAt: 1 });

beforeEach(() => resetMemoDrafts());

describe('memoDraft (M50, 헌터B #4)', () => {
  it('gives an empty draft for a trip nobody has typed in', () => {
    expect(loadMemoDraft('t1')).toEqual({ text: '', staged: [] });
  });

  it('hands back what was left mid-sentence, photos and all', () => {
    // 탭을 옮기면 `MemoComposer`가 언마운트된다 — 초안이 그 안에 살면 여기서
    // 사라졌다. 이제는 밖에 있으므로 돌아오면 그대로다.
    saveMemoDraft('t1', { text: '내일 우메다', staged: [photo('p1')] });
    expect(loadMemoDraft('t1')).toEqual({ text: '내일 우메다', staged: [photo('p1')] });
  });

  it('keeps trips apart', () => {
    saveMemoDraft('t1', { text: '오사카 쪽', staged: [] });
    saveMemoDraft('t2', { text: '교토 쪽', staged: [] });
    expect(loadMemoDraft('t1').text).toBe('오사카 쪽');
    expect(loadMemoDraft('t2').text).toBe('교토 쪽');
  });

  it('drops the slot when the draft empties out', () => {
    // 「빈 초안」과 「초안 없음」이 두 모양을 갖지 않게 (`updateEntryNote`와 같은 손질).
    saveMemoDraft('t1', { text: '쓰다 지움', staged: [] });
    saveMemoDraft('t1', { text: '', staged: [] });
    expect(loadMemoDraft('t1')).toEqual({ text: '', staged: [] });
  });

  it('keeps a draft that is only photos', () => {
    saveMemoDraft('t1', { text: '', staged: [photo('p1')] });
    expect(loadMemoDraft('t1').staged).toEqual([photo('p1')]);
  });

  it('forgets the draft once the message is sent', () => {
    saveMemoDraft('t1', { text: '보낸다', staged: [photo('p1')] });
    clearMemoDraft('t1');
    expect(loadMemoDraft('t1')).toEqual({ text: '', staged: [] });
  });
});
