import fs from "node:fs";
import path from "node:path";
import {
	requirePlaywrightChromium,
	type PlaywrightChromium,
} from "./pw_core";

type RunDemoSuiteOptions = {
	playwrightRoot: string;
	chromiumBin: string;
	outputDir: string;
};

type CrawlEntry = {
	route: string;
	title: string;
	heading: string;
};

type PlaywrightPage = {
	setContent: (content: string) => Promise<void>;
	screenshot: (options: { path: string; fullPage: boolean }) => Promise<void>;
	fill: (selector: string, value: string) => Promise<void>;
	selectOption: (selector: string, value: string) => Promise<void>;
	click: (selector: string) => Promise<void>;
	locator: (selector: string) => {
		innerText: () => Promise<string>;
	};
	evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
	title: () => Promise<string>;
	close: () => Promise<void>;
};

type PlaywrightBrowser = {
	newPage: (options?: {
		viewport?: {
			width: number;
			height: number;
		};
	}) => Promise<PlaywrightPage>;
	close: () => Promise<void>;
};

const BROWSER_ARGS = [
	"--no-sandbox",
	"--disable-dev-shm-usage",
	"--disable-gpu",
	"--disable-software-rasterizer",
];

const HOME_HTML = [
	"<!doctype html><html><head><title>ops-home</title></head><body>",
	"<h1>Ops Home</h1>",
	'<p id="description">automation launchpad</p>',
	"<nav>",
	'<a data-nav="1" href="pricing">pricing</a>',
	'<a data-nav="1" href="status">status</a>',
	'<a data-nav="1" href="contact">contact</a>',
	"</nav>",
	'<form id="job-form">',
	'<input id="email" name="email" />',
	'<select id="cadence" name="cadence">',
	'<option value="15m">15m</option>',
	'<option value="2h">2h</option>',
	"</select>",
	'<input id="retries" name="retries" type="number" min="1" max="10" value="1" />',
	'<button id="run" type="button">run</button>',
	"</form>",
	'<p id="result"></p>',
	"<script>",
	"document.querySelector('#run').addEventListener('click', () => {",
	"const email = document.querySelector('#email').value;",
	"const cadence = document.querySelector('#cadence').value;",
	"const retries = document.querySelector('#retries').value;",
	"document.querySelector('#result').textContent = email + '|' + cadence + '|' + retries;",
	"});",
	"</script>",
	"</body></html>",
].join("");

const ROUTE_HTML: Record<string, string> = {
	pricing:
		"<!doctype html><html><head><title>ops-pricing</title></head><body><h1>Pricing</h1><p>plan matrix</p></body></html>",
	status:
		"<!doctype html><html><head><title>ops-status</title></head><body><h1>Status</h1><p>all systems nominal</p></body></html>",
	contact:
		"<!doctype html><html><head><title>ops-contact</title></head><body><h1>Contact</h1><p>support desk</p></body></html>",
};

const collectCrawlResults = async (
	browser: PlaywrightBrowser,
	routes: readonly string[],
): Promise<CrawlEntry[]> => {
	const crawl: CrawlEntry[] = [];
	for (const route of routes) {
		const html = ROUTE_HTML[route];
		if (html === undefined) {
			throw new Error(`unknown route in crawl set: ${route}`);
		}
		const page = await browser.newPage();
		try {
			await page.setContent(html);
			const title = await page.title();
			const heading = await page.locator("h1").innerText();
			crawl.push({ route, title, heading });
		} finally {
			await page.close();
		}
	}
	return crawl;
};

const runDemoSuite = async ({
	playwrightRoot,
	chromiumBin,
	outputDir,
}: RunDemoSuiteOptions): Promise<string> => {
	const chromium = requirePlaywrightChromium(playwrightRoot);
	const resolvedOutput = path.resolve(outputDir);
	fs.mkdirSync(resolvedOutput, { recursive: true });

	const browser = await chromium.launch({
		executablePath: chromiumBin,
		headless: true,
		args: BROWSER_ARGS,
	});

	try {
		const homePage = await browser.newPage({
			viewport: { width: 1280, height: 720 },
		});

		await homePage.setContent(HOME_HTML);

		const screenshotPath = path.join(resolvedOutput, "landing.png");
		await homePage.screenshot({
			path: screenshotPath,
			fullPage: true,
		});

		await homePage.fill("#email", "ops@example.com");
		await homePage.selectOption("#cadence", "2h");
		await homePage.fill("#retries", "5");
		await homePage.click("#run");
		const runResult = await homePage.locator("#result").innerText();
		if (runResult !== "ops@example.com|2h|5") {
			throw new Error(`unexpected form run result: ${runResult}`);
		}

		const routes = await homePage.evaluate(() => {
			const browserGlobal = globalThis as unknown as {
				document: { querySelectorAll: (selector: string) => unknown[] };
			};
			const anchors = Array.from(
				browserGlobal.document.querySelectorAll("a[data-nav='1']"),
			) as Array<{ getAttribute: (name: string) => string | null }>;
			return anchors.map((anchor) => anchor.getAttribute("href") || "");
		});
		const crawl = await collectCrawlResults(browser, routes);

		const summary = {
			generatedAt: new Date().toISOString(),
			baseUrl: "in-memory-html-suite",
			demos: {
				screenshot: {
					file: screenshotPath,
					title: await homePage.title(),
				},
				formAutomation: {
					result: runResult,
				},
				crawl,
			},
		};

		const summaryPath = path.join(resolvedOutput, "summary.json");
		fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
		console.log("demos-pass", summaryPath);
		return summaryPath;
	} finally {
		await browser.close();
	}
};

export { runDemoSuite };
