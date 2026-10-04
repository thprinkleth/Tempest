import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const launcher = resolve(root, "Tempest.Launcher");
const require = createRequire(resolve(launcher, "package.json"));
const ts = require("typescript");
const fixture = resolve(launcher, ".svelte-kit", `verify-sessions-${process.pid}.mjs`);
const source = await readFile(resolve(launcher, "src/lib/core/launch.ts"), "utf8");
const js = ts.transpileModule(source.replace(/^import[\s\S]*?;\r?\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
const make = (id) => ({ id, path: `C:/Games/${id}`, version: "8.1", state: { type: "prepared" }, launchOptions: { args: [], dllList: [] } });
const a = make("a"), b = make("b");
const processesList = { value: [] }, launchingInstanceIds = { value: [] };
const commands = [];
let pid = 100, closeBeforeSpawn = false, failedWritePid = 0;
const setting = { get: () => undefined };
globalThis.__sessionTest = {
	instanceMap: { value: { a, b } }, lastLaunchedInstanceId: { value: undefined }, processesList, launchingInstanceIds,
	instanceStorage: { copying: [] }, prepareIndependentInstances: async () => {},
	appendProcessLog: () => {}, logCommandOutput: () => {}, processArgs: (args) => args,
	gamescopeArgs: setting, protonPath: setting, useGamescope: setting, useSteamRuntime: setting, winePath: setting, wineRuntime: setting,
	createCommand: () => {
		const callbacks = {}, writes = [];
		const child = { pid: ++pid, write: async (data) => { if (child.pid === failedWritePid) throw new Error("pipe closed"); writes.push(data); } };
		const command = { on: (name, callback) => { callbacks[name] = callback; }, spawn: async () => { if (closeBeforeSpawn) callbacks.close(); return child; }, close: () => callbacks.close(), child, writes };
		commands.push(command);
		return command;
	},
};
try {
	await mkdir(dirname(fixture), { recursive: true });
	await writeFile(fixture, `const {instanceMap,lastLaunchedInstanceId,appendProcessLog,launchingInstanceIds,logCommandOutput,processesList,gamescopeArgs,protonPath,useGamescope,useSteamRuntime,winePath,wineRuntime,createCommand,processArgs,instanceStorage,prepareIndependentInstances}=globalThis.__sessionTest;\n` + js);
	const { launchGame, killGame, stopGameSession } = await import(pathToFileURL(fixture));
	await launchGame(a); await launchGame(a); await launchGame(b);
	assert.equal(processesList.value.length, 3);
	assert.deepEqual(processesList.value.map((p) => p.sessionNumber), [1, 2, 1]);
	assert.equal(new Set(processesList.value.map((p) => p.sessionId)).size, 3);
	await stopGameSession(processesList.value[0].sessionId);
	assert.deepEqual(commands.map((c) => c.writes.length), [1, 0, 0]);
	commands[0].close();
	assert.equal(processesList.value.length, 2);
	assert.equal(processesList.value[0].sessionNumber, 2);
	await killGame(a);
	assert.deepEqual(commands.map((c) => c.writes.length), [1, 1, 0]);
	commands[1].close();
	assert.equal(processesList.value[0].instance.id, "b");
	await launchGame(a); await launchGame(a);
	failedWritePid = commands[3].child.pid;
	await assert.rejects(killGame(a), /1 session/);
	assert.equal(processesList.value.find((p) => p.child.pid === failedWritePid).status, "on");
	assert.deepEqual(commands[4].writes, ["kill\n"]);
	await assert.rejects(launchGame(a), /finish stopping/);
	commands[3].close(); commands[4].close();
	closeBeforeSpawn = true;
	await launchGame(a);
	assert.equal(processesList.value.length, 1);
	assert.deepEqual(launchingInstanceIds.value, []);
	closeBeforeSpawn = false;
	const first = launchGame(a);
	await assert.rejects(launchGame(a), /finish launching/);
	await first;
	assert.equal(processesList.value.length, 2);
	globalThis.__sessionTest.instanceStorage.copying = ["b"];
	await assert.rejects(launchGame(b), /copy to finish/);
	assert.deepEqual(launchingInstanceIds.value, []);
	console.log("Sessions: multiple launches, stop-one/stop-all scope, stable numbering, natural closes, partial stop failure, early close and concurrent-launch guards passed.");
} finally {
	delete globalThis.__sessionTest;
	await rm(fixture, { force: true });
}
