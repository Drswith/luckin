import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export class LocalStore {
  constructor({ directory = join(homedir(), ".config", "luckin-community") } = {}) {
    this.directory = directory;
  }

  read(name, fallback) {
    try {
      return JSON.parse(readFileSync(join(this.directory, `${name}.json`), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw new Error("无法读取本地记录，请检查文件权限或格式。");
    }
  }

  write(name, value) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    const path = join(this.directory, `${name}.json`), temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  }

  remember(name, value, key, limit) {
    const previous = this.read(name, []);
    this.write(name, [value, ...previous.filter((item) => item[key] !== value[key])].slice(0, limit));
  }

  snapshot() {
    return { shops: this.read("shops", []), searches: this.read("searches", []), orders: this.read("orders", []) };
  }
}
