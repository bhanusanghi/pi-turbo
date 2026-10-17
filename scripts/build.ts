import { $ } from "bun";

const examples = Bun.argv[2] === "examples";
await $`rm -rf ${examples ? "dist-examples" : "dist"}`;
await $`${Bun.argv[0]!} ./node_modules/typescript/bin/tsc -p ${examples ? "tsconfig.examples.json" : "tsconfig.json"}`;
