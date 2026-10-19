/**
 * Validates every GraphQL document the app sends against Shopify's Admin API
 * schema, offline.
 *
 * Shopify publishes the schema for each API version inside the @shopify/dev-mcp
 * package. This script downloads that package into a cache directory once,
 * extracts the schema for SHOPIFY_API_VERSION, and validates the documents.
 *
 *   npm run check:graphql
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { buildClientSchema, parse, validate } from "graphql";

import { shopify } from "@iship/connect";

const cache = join(process.cwd(), "node_modules", ".cache", "shopify-schema");
const version = shopify.SHOPIFY_API_VERSION;
const schemaFile = join(cache, `admin_${version}.json`);

if (!existsSync(schemaFile)) {
  mkdirSync(cache, { recursive: true });
  execFileSync("npm", ["pack", "@shopify/dev-mcp", "--silent"], { cwd: cache, stdio: ["ignore", "ignore", "inherit"] });
  const tarball = readdirSync(cache).find((name) => name.endsWith(".tgz"));
  const member = `package/dist/data/admin_${version}.json.gz`;
  execFileSync("tar", ["xzf", tarball, member], { cwd: cache });
  const json = gunzipSync(readFileSync(join(cache, member)));
  execFileSync("sh", ["-c", `cat > ${JSON.stringify(schemaFile)}`], { input: json });
}

const schema = buildClientSchema(JSON.parse(readFileSync(schemaFile, "utf8")).data);

let failed = 0;
for (const source of shopify.ALL_DOCUMENTS) {
  const document = parse(source);
  const name = document.definitions[0]?.name?.value ?? "(anonymous)";
  const errors = validate(schema, document);
  if (errors.length) {
    failed++;
    console.error(`✗ ${name}`);
    for (const error of errors) console.error(`    ${error.message}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

if (failed) {
  console.error(`\n${failed} document(s) do not match the ${version} Admin API schema.`);
  process.exit(1);
}
console.log(`\nAll documents match the ${version} Admin API schema.`);
