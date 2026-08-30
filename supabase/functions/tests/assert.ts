export function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEquals(
  actual: unknown,
  expected: unknown,
  message = "values differ",
): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${message}\nactual: ${actualJson}\nexpected: ${expectedJson}`,
    );
  }
}

export async function assertRejects(
  operation: () => unknown | Promise<unknown>,
  includes?: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (
      includes && !(error instanceof Error && error.message.includes(includes))
    ) {
      throw new Error(`rejection did not include ${includes}`);
    }
    return;
  }
  throw new Error("expected rejection");
}
