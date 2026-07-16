import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import { BuilderStore } from "./state";
import { CreatureAttack, DieType, EncounterCreature, avgDamageForAttack, newId } from "./types";
import { getBestiaryFiles } from "./vaultIndex";
import { parseCreature } from "./parser";
import { buildReport } from "./calculations";
import { saveEncounterNote } from "./saveEncounter";

export const VIEW_TYPE_BUILDER = "eit-encounter-builder-view";

const DIE_TYPES: DieType[] = [4, 6, 8, 10, 12, 20];

export class BuilderView extends ItemView {
	store: BuilderStore;
	unsubscribe: (() => void) | null = null;

	private partyPanelEl: HTMLElement | null = null;
	private creatureCardsEl: HTMLElement | null = null;
	private reportEl: HTMLElement | null = null;
	private encounterNameInput: HTMLInputElement | null = null;

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
		this.bestiaryFiles = getBestiaryFiles(this.app);
		this.buildLayout();
		this.unsubscribe = this.store.subscribe(() => this.renderDynamic());
		this.renderDynamic();
	}

	async onClose() {
		if (this.unsubscribe) this.unsubscribe();
	}

	private buildLayout() {
		const container = this.contentEl;
		container.empty();
		container.addClass("eit-eb-view");

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

		const split = container.createDiv({ cls: "eit-eb-split" });

		const partyPanel = split.createDiv({ cls: "eit-eb-panel" });
		partyPanel.createEl("h3", { text: "Party" });
		partyPanel.createEl("p", {
			text: "Enter your party's aggregate stats directly — keep a running note of these per party you DM for.",
			cls: "eit-eb-hint",
		});
		this.partyPanelEl = partyPanel.createDiv({ cls: "eit-eb-party-stats" });

		const creaturePanel = split.createDiv({ cls: "eit-eb-panel" });
		creaturePanel.createEl("h3", { text: "Creatures" });
		this.buildCreatureSearch(creaturePanel);
		this.creatureCardsEl = creaturePanel.createDiv({ cls: "eit-eb-cards" });

		this.reportEl = container.createDiv({ cls: "eit-eb-report" });
	}

	/**
	 * Renders the three party-wide slider+input pairs. Called once from
	 * buildLayout() and again whenever the party stats change elsewhere
	 * (there's no other mutation path here, but renderDynamic() refreshes
	 * it anyway to stay consistent with the rest of the view).
	 */
	private renderPartyStats() {
		if (!this.partyPanelEl) return;
		this.partyPanelEl.empty();

		const party = this.store.state.party;

		this.sliderWithInput(
			this.partyPanelEl,
			"Average Party AC",
			party.averageAc,
			5,
			30,
			1,
			(val) => {
				this.store.mutateQuiet((s) => {
					s.party.averageAc = val;
				});
				this.renderReport();
			}
		);

		this.sliderWithInput(
			this.partyPanelEl,
			"Party Total HP",
			party.totalHp,
			0,
			1000,
			5,
			(val) => {
				this.store.mutateQuiet((s) => {
					s.party.totalHp = val;
				});
				this.renderReport();
			}
		);

		this.sliderWithInput(
			this.partyPanelEl,
			"Party Average DPR",
			party.averageDpr,
			0,
			300,
			1,
			(val) => {
				this.store.mutateQuiet((s) => {
					s.party.averageDpr = val;
				});
				this.renderReport();
			}
		);
	}

	/**
	 * A slider and a number input that stay in sync and share one onChange.
	 * Typing a value outside the slider's range still works — the number
	 * input isn't clamped, only the slider's visual position is.
	 */
	private sliderWithInput(
		container: HTMLElement,
		label: string,
		value: number,
		min: number,
		max: number,
		step: number,
		onChange: (val: number) => void
	) {
		const wrap = container.createDiv({ cls: "eit-eb-party-field" });
		const labelRow = wrap.createDiv({ cls: "eit-eb-slider-label-row" });
		labelRow.createEl("span", { text: label });

		const numberInput = labelRow.createEl("input", {
			attr: { type: "number", style: "width: 5em;" },
			cls: "eit-eb-party-number",
		});
		numberInput.value = String(value);

		const slider = wrap.createEl("input", {
			attr: {
				type: "range",
				min: String(min),
				max: String(max),
				step: String(step),
			},
		});
		slider.value = String(Math.max(min, Math.min(max, value)));

		slider.oninput = () => {
			const val = parseFloat(slider.value);
			numberInput.value = String(val);
			onChange(val);
		};
		numberInput.onchange = () => {
			const val = parseFloat(numberInput.value);
			if (isNaN(val)) return;
			slider.value = String(Math.max(min, Math.min(max, val)));
			onChange(val);
		};
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
						resistances: 0,
						immunities: 0,
					};
					this.store.update((s) => s.creatures.push(creature));
					new Notice(
						`Added ${creature.name} with ${parsed.attacks.length} attack(s) parsed. ` +
							`Double-check counts against Multiattack — free-text parsing is best-effort.`
					);
					row.addClass("eit-it-dropdown-item-added");
				};
			}
		};

		searchInput.oninput = renderList;
		renderList();
	}

	private renderDynamic() {
		if (!this.creatureCardsEl || !this.reportEl) return;

		this.renderPartyStats();

		this.creatureCardsEl.empty();
		for (const creature of this.store.state.creatures) {
			this.renderCreatureCard(this.creatureCardsEl, creature);
		}

		this.renderReport();
	}

	private renderReport() {
		if (!this.reportEl) return;
		this.reportEl.empty();

		const report = buildReport(this.store.state.party, this.store.state.creatures);

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
			text: `Base AC ${creature.baseAc} · Base HP ${creature.baseHp}`,
			cls: "eit-eb-derived",
		});

		this.sliderField(card, "AC Bonus", creature.acBonus, -5, 10, 1, `${creature.baseAc}`, (val) => {
			this.store.mutateQuiet((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				if (c) c.acBonus = val;
			});
			this.renderReport();
		});

		const hpValueLabel = (percent: number) => {
			const effective = Math.round(creature.baseHp * (1 + percent / 100));
			return `${percent >= 0 ? "+" : ""}${percent}% → ${effective} HP`;
		};
		const hpSlider = this.sliderField(
			card,
			"HP",
			creature.hpPercent,
			-50,
			100,
			5,
			hpValueLabel(creature.hpPercent),
			(val) => {
				this.store.mutateQuiet((s) => {
					const c = s.creatures.find((x) => x.id === creature.id);
					if (c) c.hpPercent = val;
				});
				hpSlider.valueEl.setText(hpValueLabel(val));
				this.renderReport();
			}
		);

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

		// ---- Editable attack list ----
		const attacksWrap = card.createDiv({ cls: "eit-eb-attacks" });
		attacksWrap.createEl("div", { text: "Attacks", cls: "eit-eb-attacks-header" });

		for (const attack of creature.attacks) {
			this.renderAttackRow(attacksWrap, creature, attack);
		}

		const addAttackBtn = attacksWrap.createEl("button", {
			text: "+ Add Attack",
			cls: "eit-eb-add-attack-btn",
		});
		addAttackBtn.onclick = () => {
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				if (c) {
					c.attacks.push({
						id: newId(),
						name: "New Attack",
						toHit: 5,
						diceCount: 1,
						dieType: 6,
						bonus: 0,
						count: 1,
					});
				}
			});
		};
	}

	private renderAttackRow(container: HTMLElement, creature: EncounterCreature, attack: CreatureAttack) {
		const row = container.createDiv({ cls: "eit-eb-attack-row" });

		const nameInput = row.createEl("input", {
			attr: { type: "text" },
			cls: "eit-eb-attack-name",
		});
		nameInput.value = attack.name;
		nameInput.onchange = () => {
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				const a = c?.attacks.find((x) => x.id === attack.id);
				if (a) a.name = nameInput.value;
			});
		};

		const toHitWrap = row.createDiv({ cls: "eit-eb-attack-field" });
		toHitWrap.createEl("label", { text: "+hit" });
		const toHitInput = toHitWrap.createEl("input", { attr: { type: "number" } });
		toHitInput.value = String(attack.toHit);
		toHitInput.onchange = () => {
			const val = parseInt(toHitInput.value, 10);
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				const a = c?.attacks.find((x) => x.id === attack.id);
				if (a && !isNaN(val)) a.toHit = val;
			});
		};

		const diceWrap = row.createDiv({ cls: "eit-eb-attack-field" });
		diceWrap.createEl("label", { text: "dice" });
		const countInput = diceWrap.createEl("input", {
			attr: { type: "number", min: "1", style: "width: 3em;" },
		});
		countInput.value = String(attack.diceCount);
		countInput.onchange = () => {
			const val = parseInt(countInput.value, 10);
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				const a = c?.attacks.find((x) => x.id === attack.id);
				if (a && !isNaN(val)) a.diceCount = Math.max(1, val);
			});
		};

		const dieSelect = diceWrap.createEl("select");
		for (const d of DIE_TYPES) {
			const opt = dieSelect.createEl("option", { text: `d${d}`, attr: { value: String(d) } });
			if (d === attack.dieType) opt.selected = true;
		}
		dieSelect.onchange = () => {
			const val = parseInt(dieSelect.value, 10) as DieType;
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				const a = c?.attacks.find((x) => x.id === attack.id);
				if (a) a.dieType = val;
			});
		};

		const bonusWrap = row.createDiv({ cls: "eit-eb-attack-field" });
		bonusWrap.createEl("label", { text: "+bonus" });
		const bonusInput = bonusWrap.createEl("input", {
			attr: { type: "number", style: "width: 3.5em;" },
		});
		bonusInput.value = String(attack.bonus);
		bonusInput.onchange = () => {
			const val = parseInt(bonusInput.value, 10);
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				const a = c?.attacks.find((x) => x.id === attack.id);
				if (a && !isNaN(val)) a.bonus = val;
			});
		};

		const countPerRoundWrap = row.createDiv({ cls: "eit-eb-attack-field" });
		countPerRoundWrap.createEl("label", { text: "×/round" });
		const countPerRoundInput = countPerRoundWrap.createEl("input", {
			attr: { type: "number", min: "0", style: "width: 3em;" },
		});
		countPerRoundInput.value = String(attack.count);
		countPerRoundInput.onchange = () => {
			const val = parseInt(countPerRoundInput.value, 10);
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				const a = c?.attacks.find((x) => x.id === attack.id);
				if (a && !isNaN(val)) a.count = Math.max(0, val);
			});
		};

		row.createDiv({
			text: `avg ${avgDamageForAttack(attack).toFixed(1)}`,
			cls: "eit-eb-attack-avg",
		});

		const removeBtn = row.createEl("button", { text: "×", cls: "eit-it-remove-btn" });
		removeBtn.onclick = () => {
			this.store.update((s) => {
				const c = s.creatures.find((x) => x.id === creature.id);
				if (c) c.attacks = c.attacks.filter((a) => a.id !== attack.id);
			});
		};
	}

	private sliderField(
		container: HTMLElement,
		label: string,
		value: number,
		min: number,
		max: number,
		step: number,
		initialValueText: string,
		onChange: (val: number) => void
	): { valueEl: HTMLElement } {
		const wrap = container.createDiv({ cls: "eit-eb-slider-field" });
		const labelRow = wrap.createDiv({ cls: "eit-eb-slider-label-row" });
		labelRow.createEl("span", { text: label });
		const valueEl = labelRow.createEl("span", {
			text: initialValueText,
			cls: "eit-eb-slider-value",
		});

		const slider = wrap.createEl("input", {
			attr: { type: "range", min: String(min), max: String(max), step: String(step) },
		});
		slider.value = String(value);
		slider.oninput = () => {
			const val = parseFloat(slider.value);
			onChange(val);
		};

		return { valueEl };
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
		const report = buildReport(this.store.state.party, this.store.state.creatures);
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
			s.party = { averageAc: 15, totalHp: 100, averageDpr: 20 };
			s.creatures = [];
		});
	}
}
