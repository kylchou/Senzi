// Reads secrets from the environment (and .env if present). Values are never
// written to disk or logs by the collectors.

import { config as loadDotenv } from 'dotenv';

export interface CollectorEnv {
  secUserAgent: string | null;
  githubToken: string | null;
}

export function loadEnv(file = '.env'): CollectorEnv {
  // Doesn't override variables already set in the environment; a missing file is fine.
  loadDotenv({ path: file, quiet: true });
  const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    secUserAgent: clean(process.env.SEC_USER_AGENT),
    githubToken: clean(process.env.GITHUB_TOKEN),
  };
}

export class MissingEnvError extends Error {
  constructor(readonly variable: string, reason: string) {
    super(`${variable} is not set. ${reason} Add it to .env (see .env.example).`);
    this.name = 'MissingEnvError';
  }
}
