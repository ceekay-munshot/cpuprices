/**
 * Thin helper for executing SQL against local D1 via the wrangler CLI.
 *
 * Wrangler is the only way to talk to the local D1 sqlite store today; this
 * module wraps the subprocess and JSON output so callers can run queries
 * like a normal client. Production writes (CI -> remote D1) will use the
 * Cloudflare D1 REST API instead — that lives in a future d1-client.ts.
 *
 * Foreign-key enforcement: write paths in this codebase prepend
 *   PRAGMA foreign_keys = ON;
 * to every batch. PRAGMA is per-connection in SQLite, and each wrangler
 * invocation is a new connection, so the directive must accompany the work.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

const DB_NAME = 'cpuprices';
const MAX_BUFFER = 32 * 1024 * 1024; // 32 MB; defensively large for SELECTs

export interface D1ResultBlock {
  results?: Record<string, unknown>[];
  success?: boolean;
  meta?: Record<string, unknown>;
}

/**
 * Run an ad-hoc SQL command against local D1. Returns an array of result
 * blocks (one per statement). For single-row SELECTs, the data is at
 * `result[0].results[0]`.
 */
export async function execLocalCommand(sql: string): Promise<D1ResultBlock[]> {
  const { stdout } = await runWrangler([
    'wrangler', 'd1', 'execute', DB_NAME, '--local', '--command', sql, '--json',
  ]);
  return parseJsonOutput(stdout);
}

/**
 * Apply a multi-statement SQL batch (transactions, PRAGMAs, INSERTs) by
 * writing to a temp file and invoking `wrangler d1 execute --file`.
 * Returns parsed JSON output if wrangler emitted any; otherwise [].
 */
export async function execLocalBatch(sqlContent: string): Promise<D1ResultBlock[]> {
  const dir = await mkdtemp(join(tmpdir(), 'cpuprices-d1-'));
  const path = join(dir, 'batch.sql');
  await writeFile(path, sqlContent, 'utf-8');
  try {
    const { stdout } = await runWrangler([
      'wrangler', 'd1', 'execute', DB_NAME, '--local', '--file', path, '--json',
    ]);
    return parseJsonOutput(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Wrap execFile so wrangler's stderr (where it surfaces SQL syntax errors,
 * config problems, etc.) is included in the thrown error message — the
 * default error from execFile says only "Command failed: ...", which is
 * useless for debugging migration / batch failures.
 */
async function runWrangler(argv: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('npx', argv, { maxBuffer: MAX_BUFFER });
    return { stdout, stderr };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const detail = [e.stderr?.trim(), e.stdout?.trim()].filter(Boolean).join('\n---\n');
    throw new Error(
      `wrangler invocation failed: ${e.message ?? '(no message)'}` +
        (detail ? `\nwrangler output:\n${detail}` : ''),
    );
  }
}

/** Wrangler sometimes emits a banner before the JSON; extract the JSON payload. */
function parseJsonOutput(stdout: string): D1ResultBlock[] {
  const trimmed = stdout.trim();
  if (trimmed === '') return [];
  // wrangler --json typically prints pure JSON; if it's wrapped in noise,
  // grab from the first '[' to the matching tail.
  const firstBracket = trimmed.indexOf('[');
  if (firstBracket > 0) {
    return JSON.parse(trimmed.slice(firstBracket));
  }
  return JSON.parse(trimmed);
}

/** SQLite single-quoted string literal with embedded quote escaping. */
export function sqlString(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

/** Render any scalar as a SQL literal: number, escaped string, or NULL. */
export function sqlValue(v: string | number | null | undefined): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return sqlString(v);
}
