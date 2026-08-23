import { nanoid } from 'nanoid';

/** Length of every entity id in the workspace. */
export const ID_SIZE = 10;

/**
 * Fresh entity id. Short on purpose: ids show up in exported JSON and in
 * `data-*` attributes, and 10 nanoid chars are plenty for a personal planner.
 */
export const newId = (): string => nanoid(ID_SIZE);
