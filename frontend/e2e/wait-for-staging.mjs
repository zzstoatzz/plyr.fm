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

async function servedVersion(origin) {
	try {
		const response = await fetch(`${origin}/_app/version.json`, {
			cache: 'no-store',
			signal: AbortSignal.timeout(10_000)
		});
		return response.ok ? (await response.json()).version : null;
	} catch {
		return null;
	}
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
	try {
		const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(10_000) });
		return response.ok;
	} catch {
		return false;
	}
}

let announced = null;
while (Date.now() < DEADLINE) {
	const { sha } = await github('/commits/main');
	if (sha !== announced) {
		log(`head of main is ${sha.slice(0, 8)}`);
		announced = sha;
	}

	const deployment = await pagesDeployment(sha);
	if (!deployment) {
		log('pages build still running');
	} else {
		const [built, served] = await Promise.all([servedVersion(deployment), servedVersion(APP)]);
		if (!built || built !== served) {
			log(`frontend not propagated: built=${built} served=${served}`);
		} else if (!(await backendSettled(sha))) {
			log('backend deploy still running');
		} else if (!(await healthy())) {
			log('backend not healthy yet');
		} else {
			log(`staging serves ${sha.slice(0, 8)}: frontend ${served}, backend settled`);
			process.exit(0);
		}
	}
	await sleep(POLL_MS);
}

console.error('[wait-for-staging] staging never settled on the head of main');
process.exit(1);
