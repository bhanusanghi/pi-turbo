/**
 * Implementation home: optional integration-scoped task/session working state.
 *
 * Back session state with Pi entries and reconstruct from the active branch.
 * Authors write the values/reducers; the runtime does not infer relevant facts.
 * External domain state remains owned by its source and is not rolled back by
 * changing a Pi branch. Store provenance/freshness when the author requires it.
 */
export {};
