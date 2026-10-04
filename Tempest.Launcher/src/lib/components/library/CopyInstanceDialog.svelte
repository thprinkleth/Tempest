<script lang="ts">
	import { Copy, FolderOpen } from "@lucide/svelte";
	import { join } from "@tauri-apps/api/path";
	import { open as openDirectoryDialog } from "@tauri-apps/plugin-dialog";
	import Modal from "$lib/components/ui/Modal.svelte";
	import { copyInstance } from "$lib/core/instance-copy";
	import { instanceDestination } from "$lib/core/instance-storage.svelte";
	import { addToast } from "$lib/stores/ui.svelte";
	import type { Instance } from "$lib/types/instance";

	let { open = $bindable(false), instance }: { open?: boolean; instance: Instance } = $props();
	let label = $state("");
	let destination = $state("");
	let copyId = $state("");
	let busy = $state(false);
	let errorMessage = $state("");
	$effect(() => {
		if (!open) return;
		const id = crypto.randomUUID();
		copyId = id;
		label = `${instance.label} (Copy)`;
		destination = "";
		errorMessage = "";
		void instanceDestination(instance.version, id)
			.then((path) => {
				if (copyId === id) destination = path;
			})
			.catch((error) => {
				errorMessage = String(error);
			});
	});
	async function browse() {
		try {
			const parent = await openDirectoryDialog({
				directory: true,
				multiple: false,
				title: "Choose where to save the copy",
			});
			if (typeof parent === "string") destination = await join(parent, `Tempest-${copyId}`);
		} catch (error) {
			errorMessage = String(error);
		}
	}
	async function confirm() {
		if (busy || !destination || !label.trim()) return;
		busy = true;
		errorMessage = "";
		try {
			const copy = await copyInstance(instance.id, copyId, label, destination);
			addToast({
				title: "Instance copied",
				message: `${copy.label} is ready in your library.`,
				tone: "success",
			});
			open = false;
		} catch (error) {
			errorMessage = String(error);
		} finally {
			busy = false;
		}
	}
</script>

<Modal bind:open title="Copy instance" dismissible={!busy} onsubmit={confirm}>
	<div class="space-y-4">
		<p class="text-sm opacity-70">
			Copy {instance.label} with its mods, launch options, color, game version and settings. This
			needs space for another full game installation. Close the source game first.
		</p>
		<label class="flex flex-col gap-2">
			<span class="text-sm">Name</span>
			<input class="input w-full" bind:value={label} disabled={busy} required />
		</label>
		<label class="flex flex-col gap-2">
			<span class="text-sm">New game folder</span>
			<div class="flex items-center gap-2">
				<input
					class="input min-w-0 flex-1"
					bind:value={destination}
					disabled={busy}
					required
				/>
				<button
					class="btn btn-square"
					type="button"
					onclick={browse}
					disabled={busy}
					title="Choose parent folder"
					aria-label="Choose parent folder"><FolderOpen size={16} /></button
				>
			</div>
			<span class="text-xs opacity-60">The destination folder must not already exist.</span>
		</label>
		{#if errorMessage}<p class="text-error text-sm" role="alert">{errorMessage}</p>{/if}
		{#if busy}<p class="flex items-center gap-2 text-sm" role="status">
				<span class="loading loading-spinner loading-sm"></span>Copying files and settings…
			</p>{/if}
	</div>
	{#snippet actions()}
		<button class="btn btn-ghost" type="button" onclick={() => (open = false)} disabled={busy}
			>Cancel</button
		>
		<button class="btn" type="submit" disabled={busy || !destination || !label.trim()}
			><Copy size={16} />Copy instance</button
		>
	{/snippet}
</Modal>
