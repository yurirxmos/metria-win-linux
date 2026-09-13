const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const destination = join(__dirname, "..", "dist", "renderer");
mkdirSync(destination, { recursive: true });

const assets = join(__dirname, "..", "resources", "assets");
for (const name of [
  "claude-logo.png",
  "codex-logo.png",
  "opencode-logo.png",
  "cursor-logo.png",
  "antigravity-logo.png",
  "metria-logo.png",
  "metria-mascot.png"
]) {
  const sourceFile = join(assets, name);
  if (existsSync(sourceFile)) copyFileSync(sourceFile, join(destination, name));
}
