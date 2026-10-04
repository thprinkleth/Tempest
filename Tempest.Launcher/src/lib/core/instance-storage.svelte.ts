import { join, homeDir } from "@tauri-apps/api/path";
import { platform } from "@tauri-apps/plugin-os";
import { createCommand } from "$lib/core/command";
import { getInstanceBasePath } from "$lib/core/paths";
import { queueItems, queueRunning } from "$lib/rigby/stores.svelte";
import { instanceMap, updateInstance } from "$lib/stores/instance.svelte";
import { processesList } from "$lib/stores/processes.svelte";
import { defaultInstancePath } from "$lib/stores/settings.svelte";
import { allowScopeDirectory } from "$lib/tauri/scopes";
import type { Instance, InstanceLaunchOptions } from "$lib/types/instance";

export const instanceStorage = $state({
	busy: false,
	ready: false,
	error: "",
	label: "",
	copying: [] as string[],
});
let pending: Promise<void> | undefined;
let preparedSignature = "";
const normalized = (path: string) => {
	const value = path.replaceAll("\\", "/").replace(/\/+$/, "");
	return platform() === "windows" ? value.toLowerCase() : value;
};
export const instanceHome = (instance: Instance) =>
	instance.userDataDir ?? `Tempest_${instance.id}`;
export const legacyHome = (instance: Instance) =>
	instance.version === "8.1"
		? "Paladins"
		: `${instance.version ? `${instance.version}_` : ""}${instance.label}`.replaceAll(
				/[^a-zA-Z0-9-_]/g,
				"_",
			);

async function execute(args: Parameters<typeof createCommand>[0]): Promise<string> {
	const result = await createCommand(args).execute();
	if (result.code !== 0) throw new Error(result.stderr.trim() || "Instance preparation failed.");
	return result.stdout.trim();
}

export async function instanceDestination(
	version: string | undefined,
	id: string,
): Promise<string> {
	const base = defaultInstancePath.value ?? (await join(await homeDir(), "Games", "Tempest"));
	return join(base, `${(version ?? "instance").replaceAll(/[^a-zA-Z0-9._-]/g, "_")}-${id}`);
}

export function relocateLaunchOptions(
	options: InstanceLaunchOptions,
	source: string,
	target: string,
): InstanceLaunchOptions {
	const relocate = (value: string) => {
		const root = normalized(source);
		const candidate = normalized(value);
		return candidate.startsWith(`${root}/`)
			? `${target}/${value.replaceAll("\\", "/").slice(root.length + 1)}`
			: value;
	};
	return { ...options, dllList: options.dllList.map(relocate), args: [...options.args] };
}

export async function cloneInstanceFiles(
	instance: Instance,
	id: string,
	target: string,
	copyHome = true,
): Promise<{ Source: string; Output: string }> {
	const output = await execute([
		"instance",
		"clone",
		instance.path,
		{
			"--output": target,
			"--from-home": copyHome ? (instance.userDataDir ?? legacyHome(instance)) : undefined,
			"--to-home": copyHome ? `Tempest_${id}` : undefined,
			"--from-cache": id !== instance.id ? await getInstanceBasePath(instance.id) : undefined,
			"--to-cache": id !== instance.id ? await getInstanceBasePath(id) : undefined,
		},
	]);
	return JSON.parse(output) as { Source: string; Output: string };
}

export function prepareIndependentInstances(): Promise<void> {
	if (pending) return pending;
	const instances = Object.values(instanceMap.value).filter((i): i is Instance => !!i);
	const signature = JSON.stringify(instances.map((i) => [i.id, i.path, i.userDataDir]));
	if (signature === preparedSignature && instanceStorage.ready) return Promise.resolve();
	instanceStorage.busy = true;
	instanceStorage.error = "";
	pending = (async () => {
		let batch = instances;
		while (true) {
			const pathBytes = new TextEncoder().encode(JSON.stringify(batch.map((i) => i.path)));
			const encodedPaths = btoa(
				Array.from(pathBytes, (byte) => String.fromCharCode(byte)).join(""),
			);
			const expected: [string, string, string][] = [];
			const roots = batch.length
				? (JSON.parse(await execute(["instance", "roots", encodedPaths])) as string[])
				: [];
			const seen = new Set<string>();
			for (const [index, snapshot] of batch.entries()) {
				let instance = instanceMap.value[snapshot.id];
				if (!instance || instance.path !== snapshot.path) {
					throw new Error(
						"Instances changed during preparation. Retry when setup finishes.",
					);
				}
				const root = roots[index];
				if (!root) throw new Error("Could not resolve instance folder.");
				instanceStorage.label = instance.label;
				if (seen.has(normalized(root))) {
					if (
						queueRunning.value ||
						processesList.value.length ||
						instance.state.type === "setup" ||
						instance.state.type === "downloading"
					) {
						throw new Error(
							"Close games and finish or pause downloads before separating shared instances.",
						);
					}
					const target = await instanceDestination(instance.version, crypto.randomUUID());
					const copy = await cloneInstanceFiles(
						instance,
						instance.id,
						target,
						!instance.userDataDir,
					);
					updateInstance(instance.id, {
						path: copy.Output,
						managedPath: copy.Output,
						origin: "copy",
						userDataDir: `Tempest_${instance.id}`,
						launchOptions: relocateLaunchOptions(
							instance.launchOptions,
							copy.Source,
							copy.Output,
						),
					});
					const download = queueItems.value.find(
						(item) =>
							normalized(item.outDir) === normalized(snapshot.path) &&
							(item.status === "pending" || item.status === "paused"),
					);
					if (instance.state.type === "paused" && download) {
						queueItems.value = [
							...queueItems.value,
							{
								...download,
								id: `restore-${crypto.randomUUID()}`,
								outDir: copy.Output,
								manifests: [...download.manifests],
								status: "paused",
								progress: undefined,
							},
						];
					}
					instance = instanceMap.value[instance.id]!;
				} else if (instance.userDataDir !== `Tempest_${instance.id}`) {
					await execute([
						"instance",
						"prepare-home",
						{
							"--from": instance.userDataDir ?? legacyHome(instance),
							"--name": `Tempest_${instance.id}`,
						},
					]);
					updateInstance(instance.id, { userDataDir: `Tempest_${instance.id}` });
				}
				seen.add(normalized(root));
				await allowScopeDirectory(instance.path, true);
				expected.push([instance.id, instance.path, `Tempest_${instance.id}`]);
			}
			batch = Object.values(instanceMap.value).filter((i): i is Instance => !!i);
			const current = JSON.stringify(batch.map((i) => [i.id, i.path, i.userDataDir]));
			if (current !== JSON.stringify(expected)) continue;
			preparedSignature = current;
			instanceStorage.ready = true;
			return;
		}
	})()
		.catch((error) => {
			instanceStorage.ready = false;
			instanceStorage.error = String(error);
			throw error;
		})
		.finally(() => {
			pending = undefined;
			instanceStorage.busy = false;
		});
	return pending;
}

/**
 * A stale path from a view rendered before separation must never mutate another instance.
 * @param gamePath The game folder captured by the caller.
 */
export async function assertIndependentPath(gamePath: string): Promise<void> {
	const before = Object.values(instanceMap.value)
		.filter((i): i is Instance => !!i && normalized(i.path) === normalized(gamePath))
		.map((i) => i.id);
	await prepareIndependentInstances();
	if (before.some((id) => instanceStorage.copying.includes(id))) {
		throw new Error("Wait for the instance copy to finish before changing its files.");
	}
	if (
		before.length > 1 ||
		before.some((id) => normalized(instanceMap.value[id]?.path ?? "") !== normalized(gamePath))
	) {
		throw new Error(
			"This instance now has its own folder. Refresh the instance and try again.",
		);
	}
}
