import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Exercise the actual Svelte service with a mocked CLI; no game folders are touched.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const launcher = resolve(root, "Tempest.Launcher");
const require = createRequire(resolve(launcher, "package.json"));
const ts = require("typescript");
const { compileModule } = require("svelte/compiler");
const fixture = resolve(launcher, ".svelte-kit", `verify-storage-${process.pid}.mjs`);
const source = await readFile(resolve(launcher, "src/lib/core/instance-storage.svelte.ts"), "utf8");
const stripped = source.replace(/^import[\s\S]*?;\r?\n/gm, "");
const javascript = ts.transpileModule(stripped, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
const prefix = `const {join, homeDir, platform, createCommand, queueItems, queueRunning, instanceMap, updateInstance, processesList, defaultInstancePath, allowScopeDirectory} = globalThis.__storageTest;\n`;
const calls = [];
const instanceMap = { value: {} };
const queueItems = { value: [] };
const make = (id, path = "C:/Games/shared") => ({ id, path, label: id, version: "8.1", state: { type: "prepared" }, launchOptions: { args: ["-windowed"], dllList: [path + "/mod.dll"] } });
let failClone = false;
globalThis.__storageTest = {
	join: async (...parts) => parts.join("/"), homeDir: async () => "C:/Users/test", platform: () => "windows",
	allowScopeDirectory: async () => {},
	queueItems, queueRunning: { value: false }, instanceMap, processesList: { value: [] }, defaultInstancePath: { value: "C:/Games" },
	updateInstance: (id, changes) => { instanceMap.value[id] = { ...instanceMap.value[id], ...changes }; },
	createCommand: (args) => ({ execute: async () => {
		calls.push(args);
		if (args[1] === "roots") {
			const paths = JSON.parse(Buffer.from(args[2], "base64").toString("utf8"));
			return { code: 0, stderr: "", stdout: JSON.stringify(paths.map((p) => p.replace(/\/Binaries\/Win64\/Paladins.exe$/i, ""))) };
		}
		if (args[1] === "clone" && failClone) return { code: 1, stderr: "Disk full", stdout: "" };
		return { code: 0, stderr: "", stdout: args[1] === "clone" ? JSON.stringify({ Source: args[2].replace(/\/Binaries\/Win64\/Paladins.exe$/i, ""), Output: args[3]["--output"] }) : "" };
	} }),
};
try {
	await mkdir(dirname(fixture), { recursive: true });
	await writeFile(fixture, prefix + compileModule(javascript, { filename: "instance-storage.svelte.js", generate: "client" }).js.code);
	const service = await import(pathToFileURL(fixture));
	instanceMap.value = { a: make("a"), b: { ...make("b"), path: "c:/games/shared/Binaries/Win64/Paladins.exe" } };
	await service.prepareIndependentInstances();
	assert.notEqual(instanceMap.value.a.path.toLowerCase(), instanceMap.value.b.path.toLowerCase());
	assert.equal(instanceMap.value.a.userDataDir, "Tempest_a");
	assert.equal(instanceMap.value.b.userDataDir, "Tempest_b");
	assert.equal(instanceMap.value.b.origin, "copy");
	assert.equal(instanceMap.value.b.launchOptions.dllList[0], instanceMap.value.b.path + "/mod.dll");
	instanceMap.value.b.launchOptions.args.push("-new");
	assert.deepEqual(instanceMap.value.a.launchOptions.args, ["-windowed"]);
	assert.equal(calls.filter((args) => args[1] === "clone").length, 1);
	await service.prepareIndependentInstances();
	assert.equal(calls.filter((args) => args[1] === "clone").length, 1);
	instanceMap.value = { c: make("c", "C:/Games/next"), d: make("d", "C:/Games/next") };
	await assert.rejects(service.assertIndependentPath("C:/Games/next"), /own folder/);
	instanceMap.value = { e: make("e", "C:/Games/failure"), f: make("f", "C:/Games/failure") };
	failClone = true;
	await assert.rejects(service.prepareIndependentInstances(), /Disk full/);
	assert.equal(service.instanceStorage.ready, false);
	assert.equal(service.instanceStorage.busy, false);
	assert.equal(instanceMap.value.f.path, "C:/Games/failure");
	failClone = false;
	await service.prepareIndependentInstances();
	assert.equal(service.instanceStorage.ready, true);
	console.log("Instance storage: shared folders, executable aliases, home isolation, independent arguments, stale writes and failed-copy retry passed.");
} finally {
	delete globalThis.__storageTest;
	await rm(fixture, { force: true });
}
