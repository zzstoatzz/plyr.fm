/**
 * Blocks until staging serves the head of main on both halves:
 * the Cloudflare Pages build (frontend) and the fly rollout (backend).
 *
 *   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo node e2e/wait-for-staging.mjs
 */
const APP = process.env.PLYR_APP_URL ?? 'https://stg.plyr.fm';
const API = process.env.PLYR_API_URL ?? 'https://api-stg.plyr.fm';
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const PAGES_CHECK = 'Cloudflare Pages: plyr-fm-stg';
const DEPLOY_WORKFLOW = 'deploy-staging.yml';
const DEADLINE = Date.now() + 12 * 60_000;
const POLL_MS = 10_000;
const STABLE_SAMPLES = 6;

if (!REPO || !TOKEN) {
	console.error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
	process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.log(`[wait-for-staging] ${message}`);

async function github(path) {
	const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
		headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json' }
	});
	if (!response.ok) throw new Error(`github ${path} -> ${response.status}`);
	return response.json();
}

async function get(url) {
	try {
		return await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
	} catch {
		return null;
	}
}

/** what a browser needs from `origin`: the build version, and every hashed asset its html points at */
async function frontendBuild(origin) {
	const [versionResponse, htmlResponse] = await Promise.all([
		get(`${origin}/_app/version.json`),
		get(`${origin}/`)
	]);
	if (!versionResponse?.ok || !htmlResponse?.ok) return null;
	const { version } = await versionResponse.json();
	const html = await htmlResponse.text();
	const assets = [...new Set(html.match(/_app\/immutable\/[\w./-]+\.(?:js|css)/g) ?? [])].sort();
	if (assets.length === 0) return null;
	const statuses = await Promise.all(
		assets.map(async (asset) => (await get(`${origin}/${asset}`))?.status ?? 0)
	);
	return {
		version,
		assets: assets.join(','),
		missing: assets.filter((_, i) => statuses[i] !== 200)
	};
}

/** the unique Pages URL for `sha`, null while the build runs; throws if it failed */
async function pagesDeployment(sha) {
	const { check_runs: runs } = await github(`/commits/${sha}/check-runs?per_page=100`);
	const run = runs.find((candidate) => candidate.name === PAGES_CHECK);
	if (!run || run.status !== 'completed') return null;
	if (run.conclusion !== 'success') throw new Error(`${PAGES_CHECK} concluded ${run.conclusion}`);
	const url = run.output?.summary?.match(/https:\/\/[a-z0-9]+\.plyr-fm-stg\.pages\.dev/)?.[0];
	if (!url) throw new Error(`${PAGES_CHECK} succeeded without a deployment url`);
	return url;
}

/** true once no backend deploy is running and the one for `sha`, if any, succeeded */
async function backendSettled(sha) {
	const { workflow_runs: runs } = await github(
		`/actions/workflows/${DEPLOY_WORKFLOW}/runs?branch=main&per_page=20`
	);
	if (runs.some((run) => run.status !== 'completed')) return false;
	const own = runs.find((run) => run.head_sha === sha);
	if (own && own.conclusion !== 'success') {
		throw new Error(`deploy staging for ${sha.slice(0, 8)} concluded ${own.conclusion}`);
	}
	return true;
}

async function healthy() {
	return (await get(`${API}/health`))?.ok === true;
}

let announced = null;
let stable = 0;
while (Date.now() < DEADLINE) {
	const { sha } = await github('/commits/main');
	if (sha !== announced) {
		log(`head of main is ${sha.slice(0, 8)}`);
		announced = sha;
		stable = 0;
	}

	const deployment = await pagesDeployment(sha);
	if (!deployment) {
		stable = 0;
		log('pages build still running');
	} else {
		const [built, served] = await Promise.all([frontendBuild(deployment), frontendBuild(APP)]);
		const propagated =
			built !== null &&
			served !== null &&
			served.version === built.version &&
			served.assets === built.assets &&
			served.missing.length === 0;
		if (!propagated) {
			stable = 0;
			log(
				`frontend not propagated: built=${built?.version} served=${served?.version} missing=${JSON.stringify(served?.missing)}`
			);
		} else if (!(await backendSettled(sha))) {
			stable = 0;
			log('backend deploy still running');
		} else if (!(await healthy())) {
			stable = 0;
			log('backend not healthy yet');
		} else {
			stable += 1;
			log(`staging serves ${sha.slice(0, 8)} (${stable}/${STABLE_SAMPLES} consecutive samples)`);
			if (stable >= STABLE_SAMPLES) process.exit(0);
		}
	}
	await sleep(POLL_MS);
}

console.error('[wait-for-staging] staging never settled on the head of main');
process.exit(1);
