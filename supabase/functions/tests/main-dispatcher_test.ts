import { assertEquals } from "./assert.ts";
import {
  communityFunctionName,
  createMainHandler,
  type EdgeWorkerRuntime,
} from "../main/index.ts";

Deno.test("Community dispatcher exposes only the supported functions", () => {
  assertEquals(communityFunctionName("/owner-api/v2/stores"), "owner-api");
  assertEquals(communityFunctionName("/removed-hosted-function"), null);
  assertEquals(communityFunctionName("/../owner-api"), null);
});

Deno.test("Community dispatcher creates the selected worker lazily", async () => {
  const created: Array<Record<string, unknown>> = [];
  const runtime: EdgeWorkerRuntime = {
    userWorkers: {
      create(input) {
        created.push(input);
        return Promise.resolve({
          fetch: () => Promise.resolve(new Response("ok")),
        });
      },
    },
  };
  const response = await createMainHandler({ runtime, env: {} })(
    new Request("http://functions/owner-api/v2/stores"),
  );

  assertEquals(response.status, 200);
  assertEquals(created[0]?.servicePath, "/home/deno/functions/owner-api");
  assertEquals(
    (created[0]?.envVars as [string, string][]).find(([name]) =>
      name === "SUPABASE_FUNCTION_SLUG"
    )?.[1],
    "owner-api",
  );
});

Deno.test("Community dispatcher rejects deleted and unknown functions", async () => {
  const runtime: EdgeWorkerRuntime = {
    userWorkers: {
      create() {
        throw new Error("must not run");
      },
    },
  };
  const handler = createMainHandler({ runtime, env: {} });

  assertEquals(
    (await handler(new Request("http://functions/removed-private-function")))
      .status,
    404,
  );
  assertEquals(
    (await handler(new Request("http://functions/removed-hosted-function")))
      .status,
    404,
  );
});
