import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = resolve(pluginRoot, "../../release/luckin");
const files = ["LICENSE", "plugin.json", "mcp.json", "dist/server.mjs"];
const directories = ["assets", "skills", "ui"];

rmSync(releaseRoot, { recursive: true, force: true });
mkdirSync(releaseRoot, { recursive: true });

for (const file of files) {
  const target = resolve(releaseRoot, file);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(resolve(pluginRoot, file), target);
}
for (const directory of directories) {
  cpSync(resolve(pluginRoot, directory), resolve(releaseRoot, directory), { recursive: true });
}

console.log(`已生成运行安装包： ${releaseRoot}`);
