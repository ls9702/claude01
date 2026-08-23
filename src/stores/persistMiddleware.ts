import { createStore, get, set, del } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';
import { usePersistHealthStore } from './persistHealth';

/**
 * Dedicated IndexedDB database/store for Trip Board so we never collide with
 * other idb-keyval users on the same origin.
 */
const store = createStore('trip-board', 'state');

/**
 * A zustand `StateStorage` backed by IndexedDB (via idb-keyval) instead of
 * localStorage. Values are JSON strings — zustand's `persist` middleware does
 * its own serialization, so we only move strings in and out.
 *
 * All methods are async; `persist` awaits them and flips `hydrated` via
 * `onRehydrateStorage` when the initial read resolves.
 */
export const idbStorage: StateStorage = {
  async getItem(name: string): Promise<string | null> {
    try {
      const value = await get<string>(name, store);
      return value ?? null;
    } catch (err) {
      console.warn('[idbStorage] getItem failed', err);
      return null;
    }
  },
  async setItem(name: string, value: string): Promise<void> {
    try {
      await set(name, value, store);
      // Only writes are reported to persistHealth: a failed read is visible
      // (the app comes up empty), a failed write is not.
      usePersistHealthStore.getState().ok();
    } catch (err) {
      console.warn('[idbStorage] setItem failed', err);
      usePersistHealthStore.getState().fail();
    }
  },
  async removeItem(name: string): Promise<void> {
    try {
      await del(name, store);
    } catch (err) {
      console.warn('[idbStorage] removeItem failed', err);
    }
  },
};
