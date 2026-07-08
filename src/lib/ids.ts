/**
 * ULID-prefixed IDs per TechSpec §4.1 — `{prefix}_{ulid}`.
 */

import { ulid } from 'ulid';

export type IdPrefix =
  | 'wsp'
  | 'usr'
  | 'prj'
  | 'col'
  | 'tkt'
  | 'lbl'
  | 'cmt'
  | 'evt'
  | 'att'
  | 'gol' // goal
  | 'rem' // reminder
  | 'ntf' // notification
  | 'slk' // slack workspace link
  | 'scl'; // slack channel link

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}
