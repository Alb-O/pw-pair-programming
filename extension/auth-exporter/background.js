const normalizeDomain = (value) => {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim().toLowerCase();
	if (trimmed === "" || trimmed.includes(" ") || !trimmed.includes(".")) {
		return null;
	}
	return trimmed.replace(/^\./, "");
};

const partitionKeyToKeyPart = (partitionKey) => {
	if (partitionKey === undefined || partitionKey === null) {
		return "";
	}
	if (typeof partitionKey !== "object") {
		return String(partitionKey);
	}

	const topLevelSite =
		typeof partitionKey.topLevelSite === "string"
			? partitionKey.topLevelSite
			: "";
	const hasCrossSiteAncestor =
		partitionKey.hasCrossSiteAncestor === true ? "1" : "0";
	return `${topLevelSite}|${hasCrossSiteAncestor}`;
};

const dedupeCookies = (cookies) => {
	const seen = new Set();
	const unique = [];
	for (const cookie of cookies) {
		const storeId = typeof cookie.storeId === "string" ? cookie.storeId : "";
		const partitionKey = partitionKeyToKeyPart(cookie.partitionKey);
		const key = `${cookie.name}|${cookie.domain}|${cookie.path}|${storeId}|${partitionKey}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(cookie);
	}
	return unique;
};

const hasNonEmptyCookieValue = (cookie) =>
	typeof cookie.value === "string" && cookie.value.trim() !== "";

const toPlaywrightSameSite = (value) => {
	switch (value) {
		case "strict":
			return "Strict";
		case "lax":
		case "unspecified":
			return "Lax";
		case "no_restriction":
			return "None";
		default:
			return "Lax";
	}
};

const toStorageStateCookie = (cookie) => ({
	name: cookie.name,
	value: cookie.value,
	domain: cookie.domain,
	path: cookie.path,
	expires:
		typeof cookie.expirationDate === "number" &&
		Number.isFinite(cookie.expirationDate)
			? cookie.expirationDate
			: -1,
	httpOnly: cookie.httpOnly === true,
	secure: cookie.secure === true,
	sameSite: toPlaywrightSameSite(cookie.sameSite),
});

const fetchCookiesForDomain = async (domain) => {
	const direct = await chrome.cookies.getAll({ domain });
	const dotted = await chrome.cookies.getAll({ domain: `.${domain}` });
	return dedupeCookies([...direct, ...dotted])
		.filter((cookie) => hasNonEmptyCookieValue(cookie))
		.map(toStorageStateCookie);
};

const defaultFilenameForDomains = (domains) => {
	if (domains.length === 1) {
		return `${domains[0].replace(/[^a-z0-9]+/g, "_")}.state.json`;
	}
	return "playwright.state.json";
};

const exportStorageState = async (domains) => {
	const normalizedDomains = [...new Set(domains.map(normalizeDomain).filter(Boolean))];
	if (normalizedDomains.length === 0) {
		return {
			type: "error",
			message: "No valid domains selected",
		};
	}

	const cookies = [];
	for (const domain of normalizedDomains) {
		const domainCookies = await fetchCookiesForDomain(domain);
		cookies.push(...domainCookies);
	}

	if (cookies.length === 0) {
		return {
			type: "error",
			message: "No cookies found for the selected domains",
		};
	}

	return {
		type: "export_result",
		domains: normalizedDomains,
		storageState: {
			cookies,
			origins: [],
		},
		filename: defaultFilenameForDomains(normalizedDomains),
	};
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	const run = async () => {
		if (message?.type === "export") {
			const domains = Array.isArray(message.domains) ? message.domains : [];
			return exportStorageState(domains);
		}

		return {
			type: "error",
			message: "Unknown message type",
		};
	};

	run()
		.then((response) => {
			sendResponse(response);
		})
		.catch((error) => {
			sendResponse({
				type: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		});

	return true;
});
