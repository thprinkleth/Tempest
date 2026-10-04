import { instanceMap, lastLaunchedInstanceId } from "../stores/instance.svelte";
import { appendProcessLog, logCommandOutput, processesList } from "../stores/processes.svelte";
import {
	gamescopeArgs,
	protonPath,
	useGamescope,
	useSteamRuntime,
	winePath,
	wineRuntime,
} from "../stores/settings.svelte";
import { createCommand, processArgs } from "./command";
import { prepareIndependentInstances } from "./instance-storage.svelte";
import type { Instance } from "../types/instance";
import type { Process } from "../types/process";

export const launchGame = async (requestedInstance: Instance) => {
	await prepareIndependentInstances();
	const instance = instanceMap.value[requestedInstance.id] ?? requestedInstance;
	const { path, launchOptions: options } = instance;
	const platform = options.platform ?? "Win64";
	const args = processArgs(options.args ?? []);
	const hasHomeDir = args.some((arg) => /^-homedir(?:=|$)/i.test(arg));

	lastLaunchedInstanceId.value = instance.id;

	console.log("Launching instance", instance.id, instance.version);
	console.log(instance);

	appendProcessLog(`Launching game client with args: ${args.join(" ")}`, false, "launch");

	const wine = winePath.get();
	const runtime = wineRuntime.get();
	const proton =
		runtime === "proton" ? protonPath.get() : runtime === "wine" ? "wine" : undefined;
	const env: Record<string, string> | undefined =
		wine || proton
			? { ...(wine ? { WINE: wine } : {}), ...(proton ? { PROTON: proton } : {}) }
			: undefined;

	const command = createCommand(
		[
			"launch",
			path,
			{ "--platform": platform },
			{ "--no-default-args": options.noDefaultArgs },
			{ "--gamescope": useGamescope.get() },
			{ "--gamescope-args": gamescopeArgs.get() || undefined },
			{ "--steam-runtime": useSteamRuntime.get() || undefined },
			{ "--homedir": hasHomeDir ? undefined : "Paladins" },
			...(options.dllList ? options.dllList.map((dll) => ({ "--dll": dll })) : []),
			...(args.length ? ["--", ...args] : []),
		],
		env,
	);

	logCommandOutput(command, "launch");

	const launchState = { childPid: undefined as number | undefined, closed: false };
	command.on("close", () => {
		launchState.closed = true;
		if (launchState.childPid !== undefined) {
			processesList.value = processesList.value.filter(
				(p) => p.child.pid !== launchState.childPid,
			);
		}
	});

	const child = await command.spawn();
	launchState.childPid = child.pid;
	if (launchState.closed) return;

	const process: Process = {
		status: "on",
		child,
		command,
		instance,
	};

	processesList.value = [...processesList.value, process];
};

export const killGame = async (instance: Instance) => {
	const processes = processesList.value;
	const process = processes.find((p: Process) => p.instance.id === instance.id);

	if (process) await process.child.write("kill\n");
};
