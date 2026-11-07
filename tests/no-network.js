// Every test must explicitly mock its external services.
globalThis.fetch = async () => { throw new Error("Unexpected external request in test"); };
