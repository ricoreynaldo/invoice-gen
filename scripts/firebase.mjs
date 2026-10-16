// Jalankan Firebase CLI (emulator) dengan Java yang tersedia.
// Emulator butuh Java 11+. Kalau `java` tidak ada di PATH, pakai JBR bawaan
// Android Studio bila terpasang.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";

const env = { ...process.env };
const hasJava = spawnSync("java", ["-version"], { stdio: "ignore", shell: true }).status === 0;
if (!hasJava) {
  const candidates = [
    env.JAVA_HOME && join(env.JAVA_HOME, "bin"),
    "C:/Program Files/Android/Android Studio/jbr/bin",
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin",
  ].filter(Boolean);
  const bin = candidates.find((dir) => existsSync(join(dir, process.platform === "win32" ? "java.exe" : "java")));
  if (!bin) {
    console.error("Java 11+ tidak ditemukan. Pasang JDK (mis. Temurin 21) lalu coba lagi.");
    process.exit(1);
  }
  env.PATH = bin + delimiter + (env.PATH ?? env.Path ?? "");
  env.Path = env.PATH;
  env.JAVA_HOME = dirname(bin);
}

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("firebase-tools/package.json")), "lib", "bin", "firebase.js");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 1));
