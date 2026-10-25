const expectedTestDatabaseUrl =
  "postgresql://trimtime_test:local_test_only@127.0.0.1:55432/trimtime_test";

export function getTestDatabaseUrl(env: {
  TEST_DATABASE_URL?: string;
  DATABASE_URL?: string;
}): string {
  const url = env.TEST_DATABASE_URL;

  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is required; use the committed .env.test example.",
    );
  }

  if (url !== expectedTestDatabaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL must point to the disposable local database at 127.0.0.1:55432/trimtime_test.",
    );
  }

  return url;
}
