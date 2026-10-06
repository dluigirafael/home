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
					if (next == null) throw new Error("empty result");
					value = next;
					refreshedAt = Date.now();
					failedAt = 0;
					return next;
				} catch {
					failedAt = Date.now();
					return value; // stale beats blank
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

// resolves with `fallback` when `ms` elapses first
export function withDeadline(promise, ms, fallback) {
	return guard(promise, ms, fallback, null);
}

// rejects when `ms` elapses first — use it when a stuck producer must not
// wedge the cache's in-flight slot forever
export function withTimeout(promise, ms, label = "timeout") {
	return guard(promise, ms, null, new Error(label));
}

function guard(promise, ms, fallback, error) {
	let timer;
	const timeout = new Promise((resolve, reject) => {
		timer = setTimeout(() => (error ? reject(error) : resolve(fallback)), ms);
		timer.unref?.();
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
