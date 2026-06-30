// Generate config files for Roller and ZL packages based on reference JSON files.
//
// Usage: bun run package:setup

import { customLog } from '../app/utils/logger.ts';

const ROOT = process.cwd();
const REF_DIR = `${ROOT}/scripts/packageSetup`;
const OUT_DIR = `${ROOT}/scripts/packageSetup/output`;

const ROLLER_SOURCE = `${REF_DIR}/rollerProducts.json`;
const ZL_REGULAR_SOURCE = `${REF_DIR}/zlProducts.json`;
const ZL_PRIVATE_SOURCE = `${REF_DIR}/zlProductsPrivate.json`;

const ROLLER_OUT = `${OUT_DIR}/roller_packages_for_config.txt`;
const ZL_REGULAR_OUT = `${OUT_DIR}/zl_packages_regular.txt`;
const ZL_PRIVATE_OUT = `${OUT_DIR}/zl_packages_private.txt`;

function stripJsonComments(input: string) {
	let out = '';
	let inString = false;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		const next = input[i + 1] ?? '';

		if (lineComment) {
			if (ch === '\n') {
				lineComment = false;
				out += ch;
			}
			continue;
		}

		if (blockComment) {
			if (ch === '*' && next === '/') {
				blockComment = false;
				i++;
			}
			continue;
		}

		if (inString) {
			out += ch;
			if (escaped) {
				escaped = false;
			} else if (ch === '\\') {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}

		if (ch === '"') {
			inString = true;
			out += ch;
			continue;
		}

		if (ch === '/' && next === '/') {
			lineComment = true;
			i++;
			continue;
		}

		if (ch === '/' && next === '*') {
			blockComment = true;
			i++;
			continue;
		}

		out += ch;
	}

	return out;
}

async function readJsonWithComments<T>(filePath: string): Promise<T> {
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		throw new Error(`Source file not found: ${filePath}`);
	}

	const raw = await file.text();
	const cleaned = stripJsonComments(raw);
	return JSON.parse(cleaned) as T;
}

function asNumberString(value: unknown) {
	if (value == null) return null;
	const text = String(value).trim();
	if (!text) return null;
	return text;
}

function escapeYamlString(value: string) {
	return value.replaceAll('"', '\\"');
}

type RollerProduct = { id?: string | number };
type RollerPackage = {
	id?: string | number;
	name?: string;
	parentProductName?: string;
	products?: RollerProduct[];
};

type ZLPackage = {
	PackageId?: string | number;
	Alias?: string;
	LanguageData?: Array<{ Name?: string }>;
};

function buildRollerBlocks(packages: RollerPackage[], generatedAt: string) {
	const lines: string[] = [
		'# Roller Packages For Config',
		`# generated_at: ${generatedAt}`,
		'# package_name / roller_ids / zl_id / private',
		'',
	];

	const blocks: string[] = [];

	for (const pkg of packages) {
		const name = (pkg.parentProductName || pkg.name || '').trim();
		if (!name) continue;

		const ids: string[] = [];
		const topId = asNumberString(pkg.id);
		if (topId) ids.push(topId);

		for (const product of pkg.products ?? []) {
			const id = asNumberString(product.id);
			if (id && !ids.includes(id)) {
				ids.push(id);
			}
		}

		if (ids.length === 0) continue;

		blocks.push(
			`- package_name: "${escapeYamlString(name)}"\n` +
				`    roller_ids: [${ids.join(', ')}]\n` +
				`    zl_id: \n` +
				`    private: false`,
		);
	}

	lines.push(blocks.join('\n\n'));
	lines.push('');
	return lines.join('\n');
}

function getZLName(pkg: ZLPackage) {
	const alias = (pkg.Alias || '').trim();
	if (alias) return alias;
	for (const lang of pkg.LanguageData ?? []) {
		const name = (lang.Name || '').trim();
		if (name) return name;
	}
	return '';
}

function buildZLList(packages: ZLPackage[], title: string, generatedAt: string) {
	const lines: string[] = [`# ${title}`,`# generated_at: ${generatedAt}`, '# package_name | zl_id', ''];

	for (const pkg of packages) {
		const packageName = getZLName(pkg);
		const packageId = asNumberString(pkg.PackageId);
		if (!packageName || !packageId) continue;
		lines.push(`${packageName} | ${packageId}`);
	}

	lines.push('');
	return lines.join('\n');
}

async function pickPrivateSource() {
	if (await Bun.file(ZL_PRIVATE_SOURCE).exists()) {
		return ZL_PRIVATE_SOURCE;
	}
	throw new Error(`No private ZL source found. Tried: ${ZL_PRIVATE_SOURCE}`);
}

async function main() {
	const generatedAt = new Date().toISOString();
	const rollerPackages = await readJsonWithComments<RollerPackage[]>(ROLLER_SOURCE);
	const zlRegularPackages = await readJsonWithComments<ZLPackage[]>(ZL_REGULAR_SOURCE);
	const zlPrivateSource = await pickPrivateSource();
	const zlPrivatePackages = await readJsonWithComments<ZLPackage[]>(zlPrivateSource);

	await Bun.write(ROLLER_OUT, buildRollerBlocks(rollerPackages, generatedAt));
	await Bun.write(
		ZL_REGULAR_OUT,
		buildZLList(zlRegularPackages, 'ZL Regular Packages', generatedAt),
	);
	await Bun.write(
		ZL_PRIVATE_OUT,
		buildZLList(zlPrivatePackages, 'ZL Private Packages', generatedAt),
	);

	customLog('Package setup files generated:', 'INFO');
	customLog(`- ${ROLLER_OUT}`, 'INFO');
	customLog(`- ${ZL_REGULAR_OUT}`, 'INFO');
	customLog(`- ${ZL_PRIVATE_OUT}`, 'INFO');
}

await main();
