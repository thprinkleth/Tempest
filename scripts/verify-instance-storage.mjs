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
const copyFixture = resolve(launcher, ".svelte-kit", `verify-copy-${process.pid}.mjs`);
const source = await readFile(resolve(launcher, "src/lib/core/instance-storage.svelte.ts"), "utf8");
const stripped = source.replace(/^import[\s\S]*?;\r?\n/gm, "");
const javascript = ts.transpileModule(stripped, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
const prefix = `const {join, homeDir, platform, createCommand, queueItems, queueRunning, instanceMap, updateInstance, processesList, launchingInstanceIds, defaultInstancePath, allowScopeDirectory, getInstanceBasePath} = globalThis.__storageTest;\n`;
const calls = [];
const instanceMap = { value: {} };
const queueItems = { value: [] };
const make = (id, path = "C:/Games/shared") => ({ id, path, label: id, version: "8.1", state: { type: "prepared" }, launchOptions: { args: ["-windowed"], dllList: [path + "/mod.dll"] } });
let failClone = false;
globalThis.__storageTest = {
	join: async (...parts) => parts.join("/"), homeDir: async () => "C:/Users/test", platform: () => "windows",
	allowScopeDirectory: async () => {},
	getInstanceBasePath: async (id) => `C:/Config/instances/${id}`,
	launchingInstanceIds: { value: [] },
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
	assert.equal(instanceMap.value.a.userDataDir, undefined);
	assert.equal(instanceMap.value.b.userDataDir, undefined);
	assert.equal(calls.some((args) => args[1] === "prepare-home"), false);
	assert.deepEqual(calls.find((args) => args[1] === "clone")[3], { "--output": instanceMap.value.b.path, "--from-cache": undefined, "--to-cache": undefined });
	assert.equal(instanceMap.value.b.origin, "copy");
	assert.equal(instanceMap.value.b.launchOptions.dllList[0], instanceMap.value.b.path + "/mod.dll");
	instanceMap.value.b.launchOptions.args.push("-new");
	assert.deepEqual(instanceMap.value.a.launchOptions.args, ["-windowed"]);
	assert.equal(calls.filter((args) => args[1] === "clone").length, 1);
	await service.prepareIndependentInstances();
	assert.equal(calls.filter((args) => args[1] === "clone").length, 1);
	// Existing isolated homes are retained for cleanup, without preparing or copying configs.
	instanceMap.value = { old: { ...make("old", "C:/Games/old"), userDataDir: "Tempest_old" } };
	const beforeLegacy = calls.length;
	await service.prepareIndependentInstances();
	assert.equal(instanceMap.value.old.userDataDir, "Tempest_old");
	assert.deepEqual(calls.slice(beforeLegacy).map((args) => args[1]), ["roots"]);
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
	console.log("Instance storage: shared folders, executable aliases, shared Paladins configs, independent arguments, stale writes and failed-copy retry passed.");
	const copySource = await readFile(resolve(launcher, "src/lib/core/instance-copy.ts"), "utf8");
	const copyJs = ts.transpileModule(copySource.replace(/^import[\s\S]*?;\r?\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
	globalThis.__copyTest = { ...service, ...globalThis.__storageTest, instanceStorage: service.instanceStorage, addInstance: (instance) => { instanceMap.value[instance.id] = instance; } };
	await writeFile(copyFixture, `const {cloneInstanceFiles, instanceStorage, prepareIndependentInstances, relocateLaunchOptions, addInstance, instanceMap, processesList, launchingInstanceIds, queueRunning, allowScopeDirectory} = globalThis.__copyTest;\n` + copyJs);
	const { copyInstance } = await import(pathToFileURL(copyFixture));
	instanceMap.value = { g: { ...make("g", "C:/Games/source"), userDataDir: "Tempest_g", color: "#123456", manifestId: "manifest", appId: 444, launchOptions: { ...make("g").launchOptions, noDefaultArgs: true, log: true, platform: "Win32" } } };
	const copy = await copyInstance("g", "h", "My copy", "C:/Games/copy");
	assert.equal(copy.version, instanceMap.value.g.version);
	assert.equal(copy.color, instanceMap.value.g.color);
	assert.equal(copy.manifestId, "manifest");
	assert.equal(copy.appId, 444);
	assert.equal(copy.launchOptions.platform, "Win32");
	assert.equal(copy.launchOptions.noDefaultArgs, true);
	assert.equal(copy.launchOptions.log, true);
	assert.equal(copy.label, "My copy");
	assert.equal(copy.userDataDir, undefined);
	assert.deepEqual(copy.launchOptions.args, instanceMap.value.g.launchOptions.args);
	assert.notEqual(copy.launchOptions.args, instanceMap.value.g.launchOptions.args);
	assert.notEqual(copy.launchOptions.dllList, instanceMap.value.g.launchOptions.dllList);
	const copyCall = calls.findLast((args) => args[1] === "clone");
	assert.equal(copyCall[3]["--from-cache"], "C:/Config/instances/g");
	assert.equal(copyCall[3]["--to-cache"], "C:/Config/instances/h");
	assert.equal("--from-home" in copyCall[3], false);
	assert.equal("--to-home" in copyCall[3], false);
	globalThis.__storageTest.processesList.value = [{ instance: instanceMap.value.g }];
	await assert.rejects(copyInstance("g", "i", "Running copy", "C:/Games/running"), /Close this instance/);
	globalThis.__storageTest.processesList.value = [];
	failClone = true;
	await assert.rejects(copyInstance("g", "i", "Failed copy", "C:/Games/fail-copy"), /Disk full/);
	assert.equal(instanceMap.value.i, undefined);
	assert.deepEqual([...service.instanceStorage.copying], []);
	console.log("Copy Instance: version, color, manifest, launch options, independent cache, running-source refusal and failed-copy rollback passed.");
	// Exercise launch defaults with legacy metadata and explicit config overrides.
	const launches = [];
	const setting = (value) => ({ get: () => value });
	globalThis.__launchTest = {
		instanceMap: { value: {} }, lastLaunchedInstanceId: { value: undefined }, processesList: { value: [] },
		launchingInstanceIds: { value: [] }, instanceStorage: { copying: [] },
		appendProcessLog: () => {}, logCommandOutput: () => {}, prepareIndependentInstances: async () => {},
		processArgs: (args) => args,
		winePath: setting(""), wineRuntime: setting(""), protonPath: setting(""),
		useGamescope: setting(false), gamescopeArgs: setting(""), useSteamRuntime: setting(false),
		createCommand: (args) => { launches.push(args); return { on: () => {}, spawn: async () => ({ pid: launches.length }) }; },
	};
	const launchSource = await readFile(resolve(launcher, "src/lib/core/launch.ts"), "utf8");
	const launchJs = ts.transpileModule(launchSource.replace(/^import[\s\S]*?;\r?\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
	const launchPrefix = `const {instanceMap, lastLaunchedInstanceId, processesList, launchingInstanceIds, instanceStorage, appendProcessLog, logCommandOutput, prepareIndependentInstances, processArgs, winePath, wineRuntime, protonPath, useGamescope, gamescopeArgs, useSteamRuntime, createCommand} = globalThis.__launchTest; const console = { log() {} };\n`;
	const launchService = await import(`data:text/javascript;base64,${Buffer.from(launchPrefix + launchJs).toString("base64")}`);
	const oldInstance = { ...make("old", "C:/Games/old"), userDataDir: "Tempest_old" };
	for (const noDefaultArgs of [false, true]) {
		await launchService.launchGame({ ...oldInstance, launchOptions: { ...oldInstance.launchOptions, noDefaultArgs } });
		assert.equal(launches.at(-1).find((arg) => typeof arg === "object" && "--homedir" in arg)["--homedir"], "Paladins");
	}
	for (const args of [["-HoMeDiR=Custom"], ["-homedir", "Custom"]]) {
		await launchService.launchGame({ ...oldInstance, launchOptions: { ...oldInstance.launchOptions, args } });
		const command = launches.at(-1);
		assert.equal(command.find((arg) => typeof arg === "object" && "--homedir" in arg)["--homedir"], undefined);
		assert.deepEqual(command.slice(command.indexOf("--") + 1), args);
	}
	console.log("Instance storage: shared folders, executable aliases, no config copies, legacy cleanup metadata, independent arguments, stale writes and failed-copy retry passed.");
	console.log("Instance launch: shared Paladins configs with default/custom arguments and preserved explicit home overrides passed.");
} finally {
	delete globalThis.__storageTest;
	delete globalThis.__launchTest;
	delete globalThis.__copyTest;
	await rm(fixture, { force: true });
	await rm(copyFixture, { force: true });
}
