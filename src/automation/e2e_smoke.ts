import {
	requirePlaywrightChromium,
	type PlaywrightChromium,
} from "./pw_core";

type RunE2ESmokeOptions = {
	playwrightRoot: string;
	chromiumBin: string;
};

type PlaywrightBrowser = {
	newPage: () => Promise<{
		goto: (url: string) => Promise<void>;
		title: () => Promise<string>;
	}>;
	close: () => Promise<void>;
};

const BROWSER_ARGS = [
	"--no-sandbox",
	"--disable-dev-shm-usage",
	"--disable-gpu",
	"--disable-software-rasterizer",
];

const runE2ESmoke = async ({
	playwrightRoot,
	chromiumBin,
}: RunE2ESmokeOptions): Promise<void> => {
	const chromium = requirePlaywrightChromium(playwrightRoot);
	const browser = await chromium.launch({
		executablePath: chromiumBin,
		headless: true,
		args: BROWSER_ARGS,
	});

	try {
		const page = await browser.newPage();
		await page.goto("data:text/html,<title>pp-ok</title><h1>ok</h1>");
		const title = await page.title();
		if (title !== "pp-ok") {
			throw new Error(`unexpected title: ${title}`);
		}
		console.log("e2e-pass", title);
	} finally {
		await browser.close();
	}
};

export { runE2ESmoke };
