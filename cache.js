export function ttlCache(producer, { ttl, failTtl = ttl } = {}) {
	let value = null;
	let refreshedAt = 0;
	let failedAt = 0;
	let inflight = null;

	return {
		async get() {
			const now = Date.now();
			if (value !== null && now - refreshedAt < ttl) return value;
			if (now - failedAt < failTtl) return value;
			if (inflight) return inflight;

			inflight = (async () => {
				try {
					const next = await producer();
					value = next;
					refreshedAt = Date.now();
					failedAt = 0;
					return next;
				} catch {
					failedAt = Date.now();
					return value;
				} finally {
					inflight = null;
				}
			})();

			return inflight;
		},
		peek() {
			return value;
		},
	};
}

export function withDeadline(promise, ms, fallback) {
	return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
}
