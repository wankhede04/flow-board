/**
 * Unit tests for the Slack integration primitives: request signature
 * verification (TechSpec §9.5) and the /flowboard slash-command grammar.
 */

import { describe, it, expect } from 'vitest';
import {
  computeSlackSignature,
  parseDuration,
  parseSlashCommand,
  verifySlackSignature,
} from './slack';

const SECRET = '8f742231b10e8888abcd99yyyzzz85a5';

describe('verifySlackSignature', () => {
  const body = 'token=x&team_id=T123&command=%2Fflowboard&text=help';

  function signedAt(nowMs: number, offsetSec = 0) {
    const timestamp = String(Math.floor(nowMs / 1000) + offsetSec);
    return { timestamp, signature: computeSlackSignature(SECRET, timestamp, body) };
  }

  it('accepts a correctly signed request', () => {
    const nowMs = 1_800_000_000_000;
    const { timestamp, signature } = signedAt(nowMs);
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp, signature, rawBody: body, nowMs }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const nowMs = 1_800_000_000_000;
    const { timestamp, signature } = signedAt(nowMs);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp,
        signature,
        rawBody: body + '&text=evil',
        nowMs,
      }),
    ).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const nowMs = 1_800_000_000_000;
    const { timestamp, signature } = signedAt(nowMs);
    expect(
      verifySlackSignature({ signingSecret: 'other', timestamp, signature, rawBody: body, nowMs }),
    ).toBe(false);
  });

  it('rejects replays outside the 5-minute window', () => {
    const nowMs = 1_800_000_000_000;
    const { timestamp, signature } = signedAt(nowMs, -301);
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp, signature, rawBody: body, nowMs }),
    ).toBe(false);
    // …but inside the window is fine.
    const ok = signedAt(nowMs, -299);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: ok.timestamp,
        signature: ok.signature,
        rawBody: body,
        nowMs,
      }),
    ).toBe(true);
  });

  it('rejects missing headers and malformed timestamps', () => {
    const nowMs = Date.now();
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp: null, signature: 'v0=x', rawBody: body, nowMs }),
    ).toBe(false);
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp: 'abc', signature: 'v0=x', rawBody: body, nowMs }),
    ).toBe(false);
    expect(
      verifySlackSignature({ signingSecret: SECRET, timestamp: String(nowMs / 1000), signature: null, rawBody: body, nowMs }),
    ).toBe(false);
  });
});

describe('parseDuration', () => {
  it('parses minutes, hours and days', () => {
    expect(parseDuration('30m')).toBe(30);
    expect(parseDuration('45 mins')).toBe(45);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('1 day')).toBe(1440);
  });

  it('rejects junk', () => {
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('m30')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });
});

describe('parseSlashCommand', () => {
  it('returns help for empty text or help', () => {
    expect(parseSlashCommand('')).toEqual({ action: 'help' });
    expect(parseSlashCommand('  help ')).toEqual({ action: 'help' });
  });

  it('parses a plain create', () => {
    expect(parseSlashCommand('create Fix login redirect bug')).toEqual({
      action: 'create',
      title: 'Fix login redirect bug',
    });
  });

  it('parses create with project, priority, due date and context modifiers', () => {
    const cmd = parseSlashCommand('create Ship goals API p:high due:2026-08-01 ctx:personal in FB');
    expect(cmd).toEqual({
      action: 'create',
      title: 'Ship goals API',
      projectKey: 'FB',
      priority: 'high',
      dueDate: '2026-08-01',
      context: 'personal',
    });
  });

  it('rejects an unknown priority', () => {
    const cmd = parseSlashCommand('create Something p:blocker');
    expect(cmd.action).toBe('error');
  });

  it('parses move', () => {
    expect(parseSlashCommand('move FB-12 to Done')).toEqual({
      action: 'move',
      ticketKey: 'FB-12',
      targetColumn: 'Done',
    });
    expect(parseSlashCommand('move fb-3 to in progress')).toEqual({
      action: 'move',
      ticketKey: 'FB-3',
      targetColumn: 'in progress',
    });
  });

  it('rejects malformed move', () => {
    expect(parseSlashCommand('move FB-12 Done').action).toBe('error');
  });

  it('parses list scopes', () => {
    expect(parseSlashCommand('list')).toEqual({ action: 'list', scope: 'me' });
    expect(parseSlashCommand('list all')).toEqual({ action: 'list', scope: 'all' });
  });

  it('parses remind with durations and tomorrow', () => {
    expect(parseSlashCommand('remind in 30m Ship the release notes')).toEqual({
      action: 'remind',
      inMinutes: 30,
      title: 'Ship the release notes',
    });
    expect(parseSlashCommand('remind in 2 hours Standup prep')).toEqual({
      action: 'remind',
      inMinutes: 120,
      title: 'Standup prep',
    });
    expect(parseSlashCommand('remind tomorrow Pay rent')).toEqual({
      action: 'remind',
      inMinutes: 1440,
      title: 'Pay rent',
    });
  });

  it('rejects remind without a parsable time', () => {
    expect(parseSlashCommand('remind sometime Do things').action).toBe('error');
  });

  it('rejects unknown verbs', () => {
    expect(parseSlashCommand('destroy everything').action).toBe('error');
  });
});
