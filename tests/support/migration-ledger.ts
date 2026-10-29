import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";

type MigrationJournal = {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

export type ExpectedMigration = {
  tag: string;
  hash: string;
  migratedAt: string;
};

export type AppliedMigration = {
  id: number;
  hash: string;
  migratedAt: string;
};

/**
 * Derives the exact ledger a folder should produce from its journal and SQL
 * files, in journal order. Drizzle hashes the raw migration file contents and
 * records the journal `when` value as the ledger timestamp.
 */
export async function readExpectedMigrations(
  folder: string,
): Promise<ExpectedMigration[]> {
  const journal = JSON.parse(
    await readFile(join(folder, "meta", "_journal.json"), "utf8"),
  ) as MigrationJournal;

  return Promise.all(
    [...journal.entries]
      .sort((a, b) => a.idx - b.idx)
      .map(async ({ tag, when }) => ({
        tag,
        hash: createHash("sha256")
          .update(await readFile(join(folder, `${tag}.sql`)))
          .digest("hex"),
        migratedAt: String(when),
      })),
  );
}

export async function readAppliedMigrations(
  pool: Pool,
  schema: string,
): Promise<AppliedMigration[]> {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema))
    throw new Error(`Unsafe migration ledger schema: ${schema}`);
  const { rows } = await pool.query<{
    id: number;
    hash: string;
    created_at: string;
  }>(
    `SELECT id, hash, created_at FROM "${schema}"."__drizzle_migrations" ORDER BY id`,
  );

  return rows.map(({ id, hash, created_at }) => ({
    id,
    hash,
    migratedAt: String(created_at),
  }));
}

/**
 * Pairs applied rows with the journal identity at the same position so a
 * mismatch reports the migration tag instead of only an array index.
 */
export function withExpectedTags(
  applied: AppliedMigration[],
  expected: ExpectedMigration[],
): ExpectedMigration[] {
  return applied.map(({ hash, migratedAt }, index) => ({
    tag: expected[index]?.tag ?? `unexpected-migration-${index + 1}`,
    hash,
    migratedAt,
  }));
}
