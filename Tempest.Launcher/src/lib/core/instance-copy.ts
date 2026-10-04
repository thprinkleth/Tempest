import {
	cloneInstanceFiles,
	instanceStorage,
	prepareIndependentInstances,
	relocateLaunchOptions,
} from "$lib/core/instance-storage.svelte";
import { queueRunning } from "$lib/rigby/stores.svelte";
import { addInstance, instanceMap } from "$lib/stores/instance.svelte";
import { launchingInstanceIds, processesList } from "$lib/stores/processes.svelte";
import { allowScopeDirectory } from "$lib/tauri/scopes";
import type { Instance } from "$lib/types/instance";

export async function copyInstance(
	sourceId: string,
	id: string,
	label: string,
	target: string,
): Promise<Instance> {
	await prepareIndependentInstances();
	const source = instanceMap.value[sourceId];
	if (!source || source.state.type !== "prepared") {
		throw new Error("Finish setting up the source instance before copying it.");
	}
	if (!label.trim()) throw new Error("Enter a name for the copy.");
	if (id === sourceId || instanceMap.value[id]) {
		throw new Error("The copy must have a new instance ID.");
	}
	if (
		queueRunning.value ||
		launchingInstanceIds.value.includes(sourceId) ||
		processesList.value.some((p) => p.instance.id === sourceId) ||
		instanceStorage.copying.includes(sourceId)
	) {
		throw new Error("Close this instance and pause downloads before copying it.");
	}
	instanceStorage.copying = [...instanceStorage.copying, sourceId];
	try {
		const copy = await cloneInstanceFiles(source, id, target);
		const instance: Instance = {
			...source,
			id,
			label: label.trim(),
			path: copy.Output,
			managedPath: copy.Output,
			origin: "copy",
			userDataDir: undefined,
			launchOptions: relocateLaunchOptions(source.launchOptions, copy.Source, copy.Output),
			state: { type: "prepared" },
		};
		addInstance(instance);
		await allowScopeDirectory(copy.Output, true);
		return instance;
	} finally {
		instanceStorage.copying = instanceStorage.copying.filter((value) => value !== sourceId);
	}
}
