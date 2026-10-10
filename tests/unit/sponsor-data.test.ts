import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// This repo is public. Sponsor metrics are private to the sponsor, so only
// simulated placeholders may live in git. Real ones belong in the database.
function sponsorFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sponsorFiles(path);
    return dir.split(/[\\/]/).at(-1) === "sponsor" && name.endsWith(".json") ? [path] : [];
  });
}

describe("sponsor data in the repo", () => {
  const files = sponsorFiles("data/model");

  it.each(files)("%s is simulated", (file) => {
    const rows = JSON.parse(readFileSync(file, "utf8")) as { simulated?: boolean }[];
    expect(rows.filter((r) => r.simulated !== true)).toEqual([]);
  });
});
