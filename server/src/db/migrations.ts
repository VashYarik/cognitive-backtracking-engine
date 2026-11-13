// Decides which migration files still need to be applied.
// Kept free of database and file access so it can be tested on its own.

// Three digits, an underscore, then lowercase letters, digits or underscores.
// A fixed pattern means a misnamed file stops the run instead of being skipped.
const MIGRATION_NAME = /^(\d{3})_[a-z0-9][a-z0-9_]*\.sql$/;

export function pendingMigrations(
  fileNames: readonly string[],
  appliedNames: ReadonlySet<string>,
): string[] {
  const sqlFiles = fileNames.filter((name) => name.endsWith(".sql"));

  const seenNumbers = new Map<string, string>();
  for (const name of sqlFiles) {
    const match = MIGRATION_NAME.exec(name);
    if (match === null) {
      throw new Error(
        `Bad migration file name "${name}". Expected NNN_name.sql, for example 001_create_professor.sql.`,
      );
    }
    const number = match[1];
    const other = seenNumbers.get(number);
    if (other !== undefined) {
      throw new Error(
        `Two migration files share the number ${number}: "${other}" and "${name}".`,
      );
    }
    seenNumbers.set(number, name);
  }

  // Every name starts with exactly three digits, so text order is number order.
  return sqlFiles
    .filter((name) => !appliedNames.has(name))
    .sort();
}
