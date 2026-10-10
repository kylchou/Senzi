/**
 * Integration tests wipe their database between tests, so they only run
 * against a database whose name ends in "_test".
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("Set TEST_DATABASE_URL (e.g. postgresql://senzi:senzi@localhost:5432/senzi_test) to run integration tests");
  }
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run integration tests against "${name}": database name must end in _test`);
  }
  return url;
}
