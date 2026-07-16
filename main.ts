import { Plugin, WorkspaceLeaf } from "obsidian";
import { BuilderView, VIEW_TYPE_BUILDER } from "./builderView";
import { BuilderStore } from "./state";
import { BuilderState } from "./types";

export default class EitEncounterBuilderPlugin extends Plugin {
	store: BuilderStore;

	async onload() {
		this.store = new BuilderStore(async (state: BuilderState) => {
			await this.saveData(state);
		});

		const savedState = (await this.loadData()) as BuilderState | null;
		this.store.load(savedState);

		this.registerView(VIEW_TYPE_BUILDER, (leaf) => new BuilderView(leaf, this.store));

		this.addRibbonIcon("swords", "Open Encounter Builder", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-encounter-builder",
			name: "Open Encounter Builder",
			callback: () => this.activateView(),
		});
	}

	onunload() {
		// State is already persisted after every mutation; nothing to flush.
	}

	async activateView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_BUILDER);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf: WorkspaceLeaf | null = this.app.workspace.getLeaf("tab");
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_BUILDER, active: true });
		this.app.workspace.revealLeaf(leaf);
	}
}
