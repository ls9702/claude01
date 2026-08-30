/**
 * 키 점검 (M47) — three yes/no answers, on one screen, on demand.
 *
 * Every one of these has failed silently at least once in this app's life: a
 * Gemini key that expired, a Google key whose HTTP-referrer restriction stopped
 * matching after the domain move, an `ARCHIVE_DIR` the web user could not write
 * to. Each failure showed up as a *feature* quietly not working — the ✨ buttons
 * gone, the map back on OSM, a photo that seemed to upload — with nothing on
 * screen naming the cause.
 *
 * So: one button, three lines, each of which asks the question the way the real
 * feature asks it.
 *
 *   gemini   `ai.php?ping=1` — the same probe the ✨ buttons gate on. It costs
 *            no model call at all: the proxy answers from `config.php`.
 *   google   the key this device holds *and* whether the Maps script actually
 *            loads with it. A key that is present but rejected is the failure
 *            worth catching, and only a real load can tell them apart.
 *   archive  `archive.php?check=1` — is the folder there and writable, right
 *            now, on the NAS, without uploading anything.
 *
 * Never throws. A check that could not be made is a `'fail'` with a sentence
 * saying so, because "we could not ask" and "the answer is no" look identical
 * from the outside and both need the same follow-up.
 */

import { pingAi } from '../ai/aiClient';
import { loadGoogleMaps } from '../map/googleLoader';
import { loadGoogleMapsKey } from '../map/gmapsKey';
import { isConfigured, loadSettings, normalizeBaseUrl, type SyncSettings } from '../sync/settings';

/** What one line of the 키 점검 result says. */
export interface KeyCheck {
  id: 'gemini' | 'google' | 'archive';
  label: string;
  ok: boolean;
  /** One Korean sentence: what is true, or what to do about it. */
  detail: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Gemini: does the server behind the sync URL hold a key? */
async function checkGemini(settings: SyncSettings): Promise<KeyCheck> {
  const { available } = await pingAi(settings);
  return {
    id: 'gemini',
    label: 'AI (Gemini)',
    ok: available,
    detail: available
      ? '서버에 키가 있어요'
      : 'config.php의 GEMINI_API_KEY를 확인해 주세요',
  };
}

/**
 * Google Maps: a key on this device, and a script that loads with it.
 *
 * The load is the point. `bootstrap-config.json` can hand out a key that Google
 * refuses (wrong referrer, billing off, API not enabled) and the app's answer to
 * that is the same as its answer to no key at all — quietly draw OSM — so the
 * only check worth making is the one the map itself makes.
 */
async function checkGoogle(): Promise<KeyCheck> {
  const key = loadGoogleMapsKey();
  if (!key) {
    return {
      id: 'google',
      label: '구글 지도',
      ok: false,
      detail: '이 기기에 키가 없어요 (bootstrap-config.json의 googleMapsKey)',
    };
  }
  try {
    await loadGoogleMaps(key);
    return { id: 'google', label: '구글 지도', ok: true, detail: '키가 동작해요' };
  } catch {
    return {
      id: 'google',
      label: '구글 지도',
      ok: false,
      detail: '키를 불러오지 못했어요 (도메인 제한·결제 설정을 확인해 주세요)',
    };
  }
}

/** 보관함: is the configured folder there, and can the web user write to it? */
async function checkArchive(settings: SyncSettings): Promise<KeyCheck> {
  const label = '사진 보관함';
  try {
    const response = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/archive.php?check=1`, {
      method: 'GET',
      headers: { 'X-Sync-Token': settings.token, Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && isRecord(body) && body.writable === true) {
      const folder = typeof body.folder === 'string' ? body.folder : '';
      return { id: 'archive', label, ok: true, detail: `${folder} 폴더에 저장할 수 있어요` };
    }
    const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail : '';
    return {
      id: 'archive',
      label,
      ok: false,
      detail: detail || 'ARCHIVE_DIR과 보관 폴더 설정을 확인해 주세요',
    };
  } catch {
    return { id: 'archive', label, ok: false, detail: '서버에 연결할 수 없어요' };
  }
}

/**
 * Runs all three, in parallel, and never rejects.
 *
 * Parallel because they are three independent servers' worth of latency and the
 * person pressing the button is waiting; `allSettled` because one throwing must
 * not cost the other two their answers.
 */
export async function runKeyChecks(
  settings: SyncSettings = loadSettings(),
): Promise<KeyCheck[]> {
  if (!isConfigured(settings)) {
    return [
      { id: 'gemini', label: 'AI (Gemini)', ok: false, detail: '동기화 주소가 없어요' },
      await checkGoogle(),
      { id: 'archive', label: '사진 보관함', ok: false, detail: '동기화 주소가 없어요' },
    ];
  }

  const results = await Promise.allSettled([
    checkGemini(settings),
    checkGoogle(),
    checkArchive(settings),
  ]);

  const fallback: KeyCheck[] = [
    { id: 'gemini', label: 'AI (Gemini)', ok: false, detail: '확인하지 못했어요' },
    { id: 'google', label: '구글 지도', ok: false, detail: '확인하지 못했어요' },
    { id: 'archive', label: '사진 보관함', ok: false, detail: '확인하지 못했어요' },
  ];

  return results.map((result, index) =>
    result.status === 'fulfilled' ? result.value : fallback[index],
  );
}
