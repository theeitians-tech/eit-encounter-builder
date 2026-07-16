import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import { BuilderStore } from "./state";
import { EncounterCreature, PartyMember, newId } from "./types";
import { getBestiaryFiles, getPlayerFiles } from "./vaultIndex";
import { parseCreature } from "./parser";
import { buildReport, EncounterReport } from "./calculations";
import { saveEncounterNote } from "./saveEncounter";

export const VIEW_TYPE_BUILDER = "eit-encounter-builder-view";

export class BuilderView extends ItemView {
	store: BuilderStore;
	unsubscribe: (() => void) | null = null;

	private partyCardsEl: HTMLElement | null = null;
	private creatureCardsEl: HTMLElement | null = null;
	private reportEl: HTMLElement | null = null;
	private encounterNameInput: HTMLInputElement | null = null;

	private playerFiles: TFile[] = [];
	private bestiaryFiles: TFile[] = [];

	constructor(leaf: WorkspaceLeaf, store: BuilderStore) {
		super(leaf);
		this.store = store;
	}

	getViewType(): string {
		return VIEW_TYPE_BUILDER;
	}

	getDisplayText(): string {
		return "Encounter Builder";
	}

	getIcon(): string {
		return "swords";
	}

	async onOpen() {
		this.playerFiles = getPlayerFiles(this.app);
		this.bestiaryFiles = getBestiaryFiles(this.app);
		this.buildLayout();
		this.unsubscribe = this.store.subscribe(() => this.renderDynamic());
		this.renderDynamic();
	}

	async onClose() {
		if (this.unsubscribe) this.unsubscribe();
	}

	/**
	 * Builds the static shell once: toolbar, search sections, and the
	 * containers that renderDynamic() will refresh. Search inputs live
	 * here so they're never destroyed by a card/report re-render.
	 */
	private buildLayout() {
		const container = this.contentEl;
		container.empty();
		container.addClass("eit-eb-view");

		// ---- Toolbar ----
		const toolbar = container.createDiv({ cls: "eit-eb-toolbar" });
		this.encounterNameInput = toolbar.createEl("input", {
			attr: { type: "text", placeholder: "Encounter name..." },
			cls: "eit-eb-name-input",
		});
		const saveBtn = toolbar.createEl("button", { text: "Save as Note" });
		saveBtn.onclick = () => this.handleSave();

		const resetBtn = toolbar.createEl("button", {
			text: "Reset",
			cls: "eit-eb-danger-btn",
		});
		resetBtn.onclick = () => this.handleReset();

		// ---- Split screen ----
		const split = container.createDiv({ cls: "eit-eb-split" });

		const partyPanel = split.createDiv({ cls: "eit-eb-panel" });
		partyPanel.createEl("h3", { text: "Party" });

		const acRow = partyPanel.createDiv({ cls: "eit-eb-ac-row" });
		acRow.createEl("label", { text: "Average Party AC:" });
		const acInput = acRow.createEl("input", {
			attr: { type: "number", style: "width: 4em;" },
		});
		acInput.value = String(this.store.state.partyAverageAc);
		acInput.onchange = () => {
			const val = parseInt(acInput.value, 10);
			this.store.update((s) => {
				if (!isNaN(val)) s.partyAverageAc = val;
			});
		};

		this.buildPlayerSearch(partyPanel);
		this.partyCardsEl = partyPanel.createDiv({ cls: "eit-eb-cards" });

		const creaturePanel = split.createDiv({ cls: "eit-eb-panel" });
		creaturePanel.createEl("h3", { text: "Creatures" });
		this.buildCreatureSearch(creaturePanel);
		this.creatureCardsEl = creaturePanel.createDiv({ cls: "eit-eb-cards" });

		// ---- Report ----
		this.reportEl = container.createDiv({ cls: "eit-eb-report" });
	}

	private buildPlayerSearch(panel: HTMLElement) {
		const searchWrap = panel.createDiv({ cls: "eit-eb-search-wrap" });
		const searchInput = searchWrap.createEl("input", {
			attr: { type: "text", placeholder: "Search #PC notes..." },
			cls: "eit-it-search",
		});
		const listEl = searchWrap.createDiv({ cls: "eit-it-dropdown-list" });

		const renderList = () => {
			listEl.empty();
			const term = searchInput.value.trim().toLowerCase();
			const filtered = this.playerFiles.filter((f) =>
				f.basename.toLowerCase().includes(term)
			);
			if (filtered.length === 0) {
				listEl.createDiv({
					text: term ? "No matching players." : "No #PC notes found.",
					cls: "eit-it-dropdown-empty",
				});
				return;
			}
			for (const file of filtered) {
				const row = listEl.createDiv({ cls: "eit-it-dropdown-item" });
				row.createEl("span", { text: file.basename, cls: "eit-it-dropdown-name" });
				const addBtn = row.createEl("button", { text: "Add" });
				addBtn.onclick = async () => {
					const content = await this.app.vault.read(file);
					const hpMatch = content.match(/\*\*Current HP\*\*\s*(\d+)/i);
					const maxHpMatch = content.match(/\*\*Hit Points\*\*\s*(\d+)/i);
					const nameMatch = content.match(/^#\s+(.+)$/m);
					const currentHp = hpMatch
						? parseInt(hpMatch[1], 10)
						: maxHpMatch
						? parseInt(maxHpMatch[1], 10)
						: 1;
					const member: PartyMember = {
						id: newId(),
						name: nameMatch ? nameMatch[1].trim() : file.basename,
						sourcePath: file.path,
						currentHp,
						abilityMod: 3,
						proficiencyBonus: 2,
						magicBonus: 0,
						damageDiceAvg: 5,
						attacksPerRound: 1,
					};
					this.store.update((s) => s.partyMembers.push(member));
					new Notice(`Added ${member.name}. Fill in their offense stats.`);
					row.addClass("eit-it-dropdown-item-added");
				};
			}
		};

		searchInput.oninput = renderList;
		renderList();
	}

	private buildCreatureSearch(panel: HTMLElement) {
		const searchWrap = panel.createDiv({ cls: "eit-eb-search-wrap" });
		const searchInput = searchWrap.createEl("input", {
			attr: { type: "text", placeholder: "Search #bestiary notes..." },
			cls: "eit-it-search",
		});
		const listEl = searchWrap.createDiv({ cls: "eit-it-dropdown-list" });

		const renderList = () => {
			listEl.empty();
			const term = searchInput.value.trim().toLowerCase();
			const filtered = this.bestiaryFiles.filter((f) =>
				f.basename.toLowerCase().includes(term)
			);
			if (filtered.length === 0) {
				listEl.createDiv({
					text: term ? "No matching creatures." : "No #bestiary notes found.",
					cls: "eit-it-dropdown-empty",
				});
				return;
			}
			for (const file of filtered) {
				const row = listEl.createDiv({ cls: "eit-it-dropdown-item" });
				row.createEl("span", { text: file.basename, cls: "eit-it-dropdown-name" });
				const addBtn = row.createEl("button", { text: "Add" });
				addBtn.onclick = async () => {
					const content = await this.app.vault.read(file);
					const parsed = parseCreature(content, file.path);
					const creature: EncounterCreature = {
						id: newId(),
						name: parsed.name,
						sourcePath: parsed.sourcePath,
						baseAc: parsed.ac ?? 10,
						baseHp: parsed.hp ?? 1,
						attacks: parsed.attacks,
						acBonus: 0,
						hpPercent: 0,
						dmgPercent: 0,
						resistances: 0,
						immunities: 0,
					};
					this.store.update((s) => s.creatures.push(creature));
					new Notice(
						`Added ${creature.name}${
							parsed.attacks.length === 0 ? " (no attacks parsed — check its statblock)" : ""
						}.`
					);
					row.addClass("eit-it-dropdown-item-added");
				};
			}
		};

		searchInput.oninput = renderList;
		renderList();
	}

	/** Rebuilds party cards, creature cards, and the report. Called on every store change. */
	private renderDynamic() {
		if (!this.partyCardsEl || !this.creatureCardsEl || !this.reportEl) return;

		this.partyCardsEl.empty();
		for (const member of this.store.state.partyMembers) {
			this.renderPartyCard(this.partyCardsEl, member);
		}

		this.creatureCardsEl.empty();
		for (const creature of this.store.state.creatures) {
			this.renderCreatureCard(this.creatureCardsEl, creature);
		}

		this.renderReport();
	}

	private renderReport() {
		if (!this.reportEl) return;
		this.reportEl.empty();

		const report = buildReport(
			this.store.state.partyMembers,
			this.store.state.partyAverageAc,
			this.store.state.creatures
		);

		this.reportEl.createEl("h3", { text: "Report" });
		const grid = this.reportEl.createDiv({ cls: "eit-eb-report-grid" });

		this.reportStat(grid, "Party DPR", String(report.partyDpr));
		this.reportStat(grid, "Party Total HP", String(report.partyTotalHp));
		this.reportStat(grid, "Creature-side DPR", String(report.creatureSideDpr));
		this.reportStat(grid, "Creature-side Effective HP", String(report.creatureSideEffectiveHp));
		this.reportStat(
			grid,
			"Rounds for Party to Win",
			report.roundsForPartyToWin === null ? "—" : String(report.roundsForPartyToWin)
		);
		this.reportStat(
			grid,
			"Rounds for Creatures to Win",
			report.roundsForCreaturesToWin === null ? "—" : String(report.roundsForCreaturesToWin)
		);

		const winnerEl = this.reportEl.createDiv({ cls: "eit-eb-winner" });
		winnerEl.addClass(`eit-eb-winner-${report.winner}`);
		const label =
			report.winner === "party"
				? "Party wins"
				: report.winner === "creatures"
				? "Creatures win"
				: report.winner === "tie"
				? "Too close to call"
				: "Add combatants to both sides";
		winnerEl.setText(label);
	}

	private reportStat(grid: HTMLElement, label: string, value: string) {
		const cell = grid.createDiv({ cls: "eit-eb-report-stat" });
		cell.createDiv({ text: label, cls: "eit-eb-report-label" });
		cell.createDiv({ text: value, cls: "eit-eb-report-value" });
	}

	private renderPartyCard(container: HTMLElement, member: PartyMember) {
		const card = container.createDiv({ cls: "eit-eb-card" });

		const header = card.createDiv({ cls: "eit-eb-card-header" });
		header.createEl("span", { text: member.name, cls: "eit-eb-card-name" });
		const removeBtn = header.createEl("button", { text: "×", cls: "eit-it-remove-btn" });
		removeBtn.onclick = () => {
			this.store.update((s) => {
				s.partyMembers = s.partyMembers.filter((m) => m.id !== member.id);
			});
		};

		const fields = card.createDiv({ cls: "eit-eb-fields" });

		this.numberField(fields, "HP", member.currentHp, (val) => {
			this.store.update((s) => {
				const m = s.partyMembers.find((x) => x.id === member.id);
				if (m) m.currentHp = val;
			});
		});
		this.numberField(fields, "Ability Mod", member.abilityMod, (val) => {
			this.store.update((s) => {
				const m = s.partyMembers.find((x) => x.id === member.id);
				if (m) m.abilityMod = val;
			});
		});
		this.numberField(fields, "Proficiency", member.proficiencyBonus, (val) => {
			this.store.update((s) => {
				const m = s.partyMembers.find((x) => x.id === member.id);
				if (m) m.proficiencyBonus = val;
			});
		});
		this.numberField(fields, "Magic Bonus", member.magicBonus, (val) => {
			this.store.update((s) => {
				const m = s.partyMembers.find((x) => x.id === member.id);
				if (m) m.magicBonus = val;
			});
		});
		this.numberField(fields, "Dmg Dice Avg", member.damageDiceAvg, (val) => {
			this.store.update((s) => {
				const m = s.partyMembers.find((x) => x.id === member.id);
				if (m) m.damageDiceAvg = val;
			});
		});
		this.numberField(fields, "Attacks/Round", member.attacksPerRound, (val) => {
			this.store.update((s) => {
				const m = s.partyMembers.find((x) => x.id === member.id);
				if (m) m.attacksPerRound = val;
			});
		});

		const toHit = member.abilityMod + member.proficiencyBonus + member.magicBonus;
		card.createDiv({
			text: `To-hit: +${toHit}`,
			cls: "eit-eb-derived",
		});
	}

	private renderCreatureCard(container: HTMLElement, creature: EncounterCreature) {
		const card = container.createDiv({ cls: "eit-eb-card" });

		const header = card.createDiv({ cls: "eit-eb-card-header" });
		header.createEl("span", { text: creature.name, cls: "eit-eb-card-name" });
		const removeBtn = header.createEl("button", { text: "×", cls: "eit-it-remove-btn" });
		removeBtn.onclick = () => {
			this.store.update((s) => {
				s.creatures = s.creatures.filter((c) => c.id !== creature.id);
			});
		};

		card.createDiv({
			text: `Base AC ${creature.baseAc} · Base HP ${creature.baseHp} · ${creature.attacks.length} attack(s) parsed`,
			cls: "eit-eb-derived",
		});

		this.sliderField(card, "AC Bonus", creature.acBonus, -5, 10, 1, (val) => {
			this.store.mutateQuiet((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				if (c) c.acBonus = val;
			});
			this.renderReport();
		});
		this.sliderField(card, "HP %", creature.hpPercent, -50, 100, 5, (val) => {
			this.store.mutateQuiet((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				if (c) c.hpPercent = val;
			});
			this.renderReport();
		});
		this.sliderField(card, "Damage %", creature.dmgPercent, -50, 100, 5, (val) => {
			this.store.mutateQuiet((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				if (c) c.dmgPercent = val;
			});
			this.renderReport();
		});

		const toggleRow = card.createDiv({ cls: "eit-eb-toggle-row" });
		this.stepperField(toggleRow, "Resistances", creature.resistances, (val) => {
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				if (c) c.resistances = Math.max(0, val);
			});
		});
		this.stepperField(toggleRow, "Immunities", creature.immunities, (val) => {
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				if (c) c.immunities = Math.max(0, val);
			});
		});
	}

	private numberField(
		container: HTMLElement,
		label: string,
		value: number,
		onChange: (val: number) => void
	) {
		const wrap = container.createDiv({ cls: "eit-eb-field" });
		wrap.createEl("label", { text: label });
		const input = wrap.createEl("input", { attr: { type: "number" } });
		input.value = String(value);
		input.onchange = () => {
			const val = parseFloat(input.value);
			if (!isNaN(val)) onChange(val);
		};
	}

	private sliderField(
		container: HTMLElement,
		label: string,
		value: number,
		min: number,
		max: number,
		step: number,
		onChange: (val: number) => void
	) {
		const wrap = container.createDiv({ cls: "eit-eb-slider-field" });
		const labelRow = wrap.createDiv({ cls: "eit-eb-slider-label-row" });
		labelRow.createEl("span", { text: label });
		const valueEl = labelRow.createEl("span", {
			text: String(value),
			cls: "eit-eb-slider-value",
		});

		const slider = wrap.createEl("input", {
			attr: {
				type: "range",
				min: String(min),
				max: String(max),
				step: String(step),
			},
		});
		slider.value = String(value);
		slider.oninput = () => {
			const val = parseFloat(slider.value);
			valueEl.setText(String(val));
			onChange(val);
		};
	}

	private stepperField(
		container: HTMLElement,
		label: string,
		value: number,
		onChange: (val: number) => void
	) {
		const wrap = container.createDiv({ cls: "eit-eb-stepper-field" });
		wrap.createEl("span", { text: label });
		const minusBtn = wrap.createEl("button", { text: "-" });
		const valueEl = wrap.createEl("span", { text: String(value), cls: "eit-eb-stepper-value" });
		const plusBtn = wrap.createEl("button", { text: "+" });

		let current = value;
		minusBtn.onclick = () => {
			current = Math.max(0, current - 1);
			valueEl.setText(String(current));
			onChange(current);
		};
		plusBtn.onclick = () => {
			current += 1;
			valueEl.setText(String(current));
			onChange(current);
		};
	}

	private async handleSave() {
		const name = this.encounterNameInput?.value.trim() || "Untitled Encounter";
		const report = buildReport(
			this.store.state.partyMembers,
			this.store.state.partyAverageAc,
			this.store.state.creatures
		);
		try {
			const path = await saveEncounterNote(this.app, this.store.state, report, name);
			new Notice(`Saved encounter to ${path}`);
		} catch (err) {
			new Notice(`Couldn't save encounter: ${(err as Error).message}`);
		}
	}

	private handleReset() {
		if (!confirm("Clear the entire encounter builder? This can't be undone.")) return;
		this.store.update((s) => {
			s.partyMembers = [];
			s.creatures = [];
			s.partyAverageAc = 15;
		});
	}
}
