let domains = new Set();
let currentTabDomain = null;

const domainList = document.getElementById("domainList");
const newDomainInput = document.getElementById("newDomain");
const addDomainBtn = document.getElementById("addDomainBtn");
const filenameInput = document.getElementById("filenameInput");
const exportBtn = document.getElementById("exportBtn");
const messageArea = document.getElementById("messageArea");

const extractDomain = (url) => {
	try {
		return new URL(url).hostname;
	} catch {
		return null;
	}
};

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

const defaultFilenameForDomains = (selectedDomains) => {
	if (selectedDomains.length === 1) {
		return `${selectedDomains[0].replace(/[^a-z0-9]+/g, "_")}.state.json`;
	}
	return "playwright.state.json";
};

const saveDomains = () => {
	chrome.storage.local.set({
		pw_export_domains: [...domains],
	});
};

const saveFilename = () => {
	chrome.storage.local.set({
		pw_export_filename: filenameInput.value,
	});
};

const showMessage = (type, text) => {
	messageArea.innerHTML = "";
	const div = document.createElement("div");
	div.className = `message ${type}`;
	div.textContent = text;
	messageArea.appendChild(div);
	if (type === "success") {
		setTimeout(() => div.remove(), 5000);
	}
};

const updateExportState = () => {
	exportBtn.disabled = domains.size === 0;
};

const maybeRefreshFilename = () => {
	const selectedDomains = [...domains];
	if (
		filenameInput.value.trim() === "" ||
		filenameInput.dataset.autoName === "1"
	) {
		filenameInput.value = defaultFilenameForDomains(selectedDomains);
		filenameInput.dataset.autoName = "1";
	}
};

const renderDomains = () => {
	domainList.innerHTML = "";
	if (domains.size === 0) {
		const empty = document.createElement("div");
		empty.style.color = "#8b96a7";
		empty.style.fontSize = "12px";
		empty.style.padding = "6px 0";
		empty.textContent = "No domains added";
		domainList.appendChild(empty);
		updateExportState();
		return;
	}

	for (const domain of domains) {
		const row = document.createElement("div");
		row.className = "domain-item";

		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.checked = true;
		checkbox.id = `domain-${domain}`;

		const label = document.createElement("label");
		label.htmlFor = checkbox.id;
		label.textContent = domain;

		const removeBtn = document.createElement("button");
		removeBtn.className = "secondary";
		removeBtn.textContent = "×";
		removeBtn.style.marginLeft = "auto";
		removeBtn.style.padding = "3px 8px";
		removeBtn.onclick = () => {
			domains.delete(domain);
			saveDomains();
			maybeRefreshFilename();
			renderDomains();
		};

		row.appendChild(checkbox);
		row.appendChild(label);
		row.appendChild(removeBtn);
		domainList.appendChild(row);
	}

	updateExportState();
};

const addDomain = () => {
	const typed = newDomainInput.value.trim().toLowerCase();
	const candidate = typed === "" ? currentTabDomain : typed;
	const domain = normalizeDomain(candidate);
	if (domain === null) {
		showMessage("error", "Invalid domain format");
		return;
	}
	domains.add(domain);
	newDomainInput.value = "";
	saveDomains();
	maybeRefreshFilename();
	renderDomains();
};

const downloadStorageState = (filename, storageState) => {
	const jsonText = `${JSON.stringify(storageState, null, 2)}\n`;
	const blob = new Blob([jsonText], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => {
		URL.revokeObjectURL(url);
	}, 1_000);
};

const exportSelectedDomains = () => {
	const selected = [...domains].filter((domain) => {
		const checkbox = document.getElementById(`domain-${domain}`);
		return checkbox?.checked === true;
	});
	if (selected.length === 0) {
		showMessage("error", "No domains selected");
		return;
	}

	const filename = filenameInput.value.trim() || defaultFilenameForDomains(selected);
	showMessage("info", `Exporting cookies for ${selected.length} domain(s)...`);
	chrome.runtime.sendMessage(
		{
			type: "export",
			domains: selected,
		},
		(response) => {
			if (chrome.runtime.lastError) {
				showMessage(
					"error",
					chrome.runtime.lastError.message || "Export failed",
				);
				return;
			}
			if (response?.type === "error") {
				showMessage("error", response.message || "Export failed");
				return;
			}
			if (
				response?.type !== "export_result" ||
				typeof response.storageState !== "object" ||
				response.storageState === null
			) {
				showMessage("error", "Background worker returned invalid export data");
				return;
			}

			downloadStorageState(filename, response.storageState);
			showMessage(
				"success",
				`Downloaded ${filename}. Load it with: pw-cli state-load ${filename}`,
			);
		},
	);
};

const init = async () => {
	const stored = await chrome.storage.local.get([
		"pw_export_domains",
		"pw_export_filename",
	]);
	if (Array.isArray(stored.pw_export_domains)) {
		domains = new Set(stored.pw_export_domains.map(normalizeDomain).filter(Boolean));
	}
	if (
		typeof stored.pw_export_filename === "string" &&
		stored.pw_export_filename.trim() !== ""
	) {
		filenameInput.value = stored.pw_export_filename;
		filenameInput.dataset.autoName = "0";
	} else {
		filenameInput.dataset.autoName = "1";
	}

	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		if (tab?.url) {
			currentTabDomain = normalizeDomain(extractDomain(tab.url));
			if (currentTabDomain) {
				newDomainInput.placeholder = currentTabDomain;
				if (domains.size === 0) {
					domains.add(currentTabDomain);
				}
			}
		}
	} catch {
		// ignore tab query failure
	}

	maybeRefreshFilename();
	renderDomains();
};

addDomainBtn.onclick = addDomain;
newDomainInput.onkeydown = (event) => {
	if (event.key === "Enter") {
		addDomain();
	}
};
filenameInput.oninput = () => {
	filenameInput.dataset.autoName = "0";
	saveFilename();
};
exportBtn.onclick = exportSelectedDomains;

void init();
