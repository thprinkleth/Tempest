<script lang="ts">
	import "$lib/styles/global.css";
	// @ts-ignore
	import "@fontsource-variable/ubuntu-sans-mono";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
	import { Tooltip } from "bits-ui";
	import { onDestroy, untrack } from "svelte";
	import favicon from "$lib/assets/favicon.ico?url";
	import AppShell from "$lib/components/layout/AppShell.svelte";
	import OnboardingPage from "$lib/components/onboarding/OnboardingPage.svelte";
	import Modal from "$lib/components/ui/Modal.svelte";
	import {
		instanceStorage,
		prepareIndependentInstances,
	} from "$lib/core/instance-storage.svelte";
	import { cleanupRegistryState, initializeCleanupRegistry } from "$lib/core/uninstall.svelte";
	import { setQueryClient } from "$lib/queries/client";
	import { instanceMap } from "$lib/stores/instance.svelte";
	import { updaterStore } from "$lib/stores/updater.svelte";

	const { children } = $props();
	onDestroy(initializeCleanupRegistry());
	const queryClient = new QueryClient();
	setQueryClient(queryClient);

	let checkedLibrary = false;

	const inOnboarding = $derived(page.url.pathname === "/onboarding");

	$effect(() => {
		updaterStore.checkForUpdates(true);
	});

	$effect(() => {
		if (!cleanupRegistryState.ready) return;
		// Track only storage changes; never update mods across the library at startup.
		JSON.stringify(
			Object.values(instanceMap.value).map((i) => i && [i.id, i.path, i.userDataDir]),
		);
		untrack(() => void prepareIndependentInstances().catch(() => {}));
	});

	// Once per launch: route through onboarding when no game instances exist yet.
	$effect(() => {
		if (!cleanupRegistryState.ready) return;
		if (checkedLibrary) return;
		checkedLibrary = true;
		if (Object.keys(instanceMap.value).length === 0) void goto("/onboarding");
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Tempest Launcher</title>
</svelte:head>

<QueryClientProvider client={queryClient}>
	<Tooltip.Provider delayDuration={400}>
		{#if instanceStorage.error}
			<div class="alert alert-error" role="alert">
				<span>{instanceStorage.error}</span>
				<button
					class="btn btn-sm"
					onclick={() => void prepareIndependentInstances().catch(() => {})}
					>Retry instance preparation</button
				>
			</div>
		{/if}
		{#if inOnboarding}
			<!-- Full-screen first-run experience; finishing navigates back to "/". -->
			<OnboardingPage />
		{:else}
			<AppShell {children} />
		{/if}
		<Modal
			open={instanceStorage.busy}
			title="Preparing independent instances"
			dismissible={false}
		>
			<div class="flex items-center gap-3">
				<span class="loading loading-spinner loading-sm"></span>
				<p>{instanceStorage.label || "Checking game folders…"}</p>
			</div>
			<p class="mt-3 text-sm opacity-70">
				Shared folders are copied so each instance has its own mods and settings. This may
				take a while.
			</p>
		</Modal>
	</Tooltip.Provider>
</QueryClientProvider>
