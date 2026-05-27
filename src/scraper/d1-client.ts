/**
 * Unified D1 access layer.
 *
 * Two implementations behind one interface:
 *   - createLocalD1Executor()  -> wrangler subprocess against the local sqlite store
 *   - createRemoteD1Executor() -> Cloudflare D1 REST API
 *
 * The pipeline module takes an executor as a parameter, so the same scrape /
 * insert code path serves both local-dev runs and production-shaped remote
 * runs. Secrets are read from the environment and never logged.
 *
 * Required env for the remote executor:
 *   CLOUDFLARE_API_TOKEN       Bearer token; D1 read+write on the database
 *   CLOUDFLARE_ACCOUNT_ID      Cloudflare account ID
 *   CLOUDFLARE_D1_DATABASE_ID  D1 database UUID (same value as wrangler.toml's database_id)
 *
 * .env is auto-loaded from the current working directory if present; existing
 * process env always wins, so shell exports take precedence.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  execLocalBatch,
  execLocalCommand,
  sqlString,
  sqlValue,
  type D1ResultBlock,
} from './d1-local';

// Re-export so callers don't need to also import from d1-local.
export type { D1ResultBlock };
export { sqlString, sqlValue };

export interface D1Executor {
  /** Execute a single (or short) SQL statement. Use for SELECT or one-off writes. */
  exec(sql: string): Promise<D1ResultBlock[]>;
  /** Execute a multi-statement SQL batch. Use for large INSERT chunks. */
  execBatch(sql: string): Promise<D1ResultBlock[]>;
  /** Short label for logs and error messages, e.g. "local" or "remote". */
  readonly label: string;
}

// ============================================================================
// Local executor — wraps the existing wrangler subprocess helpers.
// ============================================================================

export function createLocalD1Executor(): D1Executor {
  return {
    label: 'local',
    exec: (sql) => execLocalCommand(sql),
    execBatch: (sql) => execLocalBatch(sql),
  };
}

// ============================================================================
// Remote executor — Cloudflare D1 REST API.
// ============================================================================

const REMOTE_MAX_REQUEST_BYTES = 900_000; // conservative ceiling under D1's ~1MB per-request limit

// Bounded retry for transient D1 errors (network blip, 5xx, 429). 3 total
// attempts means worst-case 0 + 0.5 + 1.5 = 2s of backoff before surfacing.
// Chosen to be tight enough that the 20-min GitHub Actions timeout still
// has headroom across 12+ chunked inserts even if every chunk hits one
// transient before succeeding.
const REMOTE_MAX_ATTEMPTS = 3;
const REMOTE_BACKOFF_MS = [500, 1500];

interface CfApiSuccess {
  success: true;
  result: D1ResultBlock[];
}

interface CfApiFailure {
  success: false;
  errors: Array<{ code: number; message: string }>;
  messages?: Array<{ message: string }>;
}

type CfApiResponse = CfApiSuccess | CfApiFailure;

/**
 * Classifies an outcome as worth retrying. Conservative on purpose — we
 * only retry the obviously-transient class so a malformed SQL doesn't
 * burn the full backoff budget before surfacing.
 *
 *   - Network errors (fetch threw): always transient
 *   - HTTP 429 / 5xx: transient (rate limit, gateway, upstream timeout)
 *   - HTTP 4xx other: deterministic, do NOT retry
 *   - Cloudflare API success=false: do NOT retry (SQL error, schema issue)
 */
type RemoteAttempt =
  | { kind: 'ok'; result: D1ResultBlock[] }
  | { kind: 'transient'; error: Error }
  | { kind: 'fatal'; error: Error };

export function createRemoteD1Executor(): D1Executor {
  loadDotEnvIfPresent();
  const apiToken = requireEnv('CLOUDFLARE_API_TOKEN');
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const databaseId = requireEnv('CLOUDFLARE_D1_DATABASE_ID');

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  const attempt = async (sql: string): Promise<RemoteAttempt> => {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql }),
      });
    } catch (err: unknown) {
      // Network-level error (DNS, TCP, TLS). The error message from fetch
      // does not contain the token; safe to surface.
      const msg = err instanceof Error ? err.message : String(err);
      return {
        kind: 'transient',
        error: new Error(`D1 remote: network error contacting Cloudflare API: ${msg}`),
      };
    }

    if (!res.ok) {
      const text = await safeReadText(res);
      const err = new Error(
        `D1 remote: HTTP ${res.status} ${res.statusText} from Cloudflare API\n` +
          `body: ${truncate(text, 800)}`,
      );
      const isTransient = res.status === 429 || res.status >= 500;
      return { kind: isTransient ? 'transient' : 'fatal', error: err };
    }

    const body = (await res.json()) as CfApiResponse;
    if (!body.success) {
      const errs = body.errors?.map((e) => `[${e.code}] ${e.message}`).join('; ') ?? '(no error detail)';
      // success:false is deterministic (bad SQL, schema violation, etc.) —
      // retrying would just waste backoff time before surfacing the same error.
      return {
        kind: 'fatal',
        error: new Error(`D1 remote: Cloudflare API returned success=false: ${errs}`),
      };
    }
    return { kind: 'ok', result: body.result ?? [] };
  };

  const post = async (sql: string): Promise<D1ResultBlock[]> => {
    const bodyBytes = Buffer.byteLength(sql, 'utf-8');
    if (bodyBytes > REMOTE_MAX_REQUEST_BYTES) {
      throw new Error(
        `D1 remote request body is ${bodyBytes.toLocaleString()} bytes; the pipeline should chunk before reaching this layer (cap ${REMOTE_MAX_REQUEST_BYTES.toLocaleString()}).`,
      );
    }

    let lastError: Error | undefined;
    for (let i = 0; i < REMOTE_MAX_ATTEMPTS; i++) {
      const outcome = await attempt(sql);
      if (outcome.kind === 'ok') return outcome.result;
      if (outcome.kind === 'fatal') throw outcome.error;
      lastError = outcome.error;
      const backoff = REMOTE_BACKOFF_MS[i];
      if (backoff != null) {
        await new Promise((resolveTimer) => setTimeout(resolveTimer, backoff));
      }
    }
    throw new Error(
      `D1 remote: ${REMOTE_MAX_ATTEMPTS} transient attempts exhausted. Last error: ${lastError?.message ?? '(none)'}`,
    );
  };

  return {
    label: 'remote',
    // For the REST endpoint exec and execBatch are the same call; the
    // distinction matters only for the local wrangler subprocess.
    exec: post,
    execBatch: post,
  };
}

// ============================================================================
// Env / .env helpers (no external dependency)
// ============================================================================

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v == null || v === '') {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `Set it in .env (see .env.example) or export it before running, for example:\n` +
        `  export ${name}=...\n` +
        `\nSecrets are never written to logs or commits.`,
    );
  }
  return v;
}

/**
 * Minimal .env loader. KEY=VALUE per line; comments start with #; values may
 * be surrounded by matched single or double quotes. Already-set environment
 * variables take precedence (so shell exports win). Silently does nothing
 * if .env is absent.
 */
function loadDotEnvIfPresent(): void {
  const path = resolve(process.cwd(), '.env');
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2] ?? '';
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const key = m[1]!;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '(failed to read body)';
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '... (truncated)' : s;
}
