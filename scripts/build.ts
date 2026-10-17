import { $ } from "bun";

await $`rm -rf dist`;
await $`${Bun.argv[0]!} ./node_modules/typescript/bin/tsc -p tsconfig.json`;
