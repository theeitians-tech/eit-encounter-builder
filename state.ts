import { BuilderState, emptyBuilderState } from "./types";

type Listener = () => void;

export class BuilderStore {
	state: BuilderState = emptyBuilderState();
	private listeners: Listener[] = [];
	private persistFn: (state: BuilderState) => Promise<void>;

	constructor(persistFn: (state: BuilderState) => Promise<void>) {
		this.persistFn = persistFn;
	}

	load(state: BuilderState | null) {
		this.state = state ?? emptyBuilderState();
		this.notify();
	}

	subscribe(fn: Listener) {
		this.listeners.push(fn);
		return () => {
			this.listeners = this.listeners.filter((l) => l !== fn);
		};
	}

	private notify() {
		for (const l of this.listeners) l();
		void this.persistFn(this.state);
	}

	update(mutator: (state: BuilderState) => void) {
		mutator(this.state);
		this.notify();
	}

	/**
	 * Mutates and persists without notifying subscribers — used for slider
	 * drags, where a full re-render mid-drag would recreate the slider DOM
	 * element and interrupt the gesture. Callers are responsible for
	 * updating whatever live display (e.g. the report) needs to reflect
	 * the change themselves.
	 */
	mutateQuiet(mutator: (state: BuilderState) => void) {
		mutator(this.state);
		void this.persistFn(this.state);
	}
}
