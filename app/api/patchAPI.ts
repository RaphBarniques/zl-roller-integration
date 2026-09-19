// Patch API FUNCTIONS
//
// Usage: createOrUpdateContact(playerInfo, gameInfo)
// Returns: Response from Patch API or null if failed

import { customLog } from '../utils/logger.ts';
import { config } from '../preflight.ts';

export type PatchContactPayload = {
	email?: string;
	first_name?: string;
	last_name?: string;
	phone?: string;
	gender?: string;
	date_of_birth?: string;
	postal_code?: string;
	tags?: string[];
	custom_fields?: Record<string, string | number | boolean | null>;
};

async function getPatchHeaders() {
	const patchToken = Bun.env.PATCH_API_TOKEN;
	const patchAccountId = Bun.env.PATCH_ACCOUNT_ID;

	if (!patchToken || !patchAccountId) {
		customLog(
			'Missing PATCH_API_TOKEN or PATCH_ACCOUNT_ID environment variables',
			'ERROR',
		);
		return null;
	}

	return {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${patchToken}`,
		'X-Account-Id': patchAccountId,
		'X-Relationships': 'all',
	};
}

export async function createOrUpdatePatchContact(
	payload: PatchContactPayload,
): Promise<Record<string, unknown> | null> {
	const retryMax = 3;
	const delay = 1000;

	const headers = await getPatchHeaders();
	if (!headers) {
		return null;
	}

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		try {
			const response = await fetch(
				'https://api.patchretention.com/v2/contacts',
				{
					method: 'PATCH',
					headers,
					body: JSON.stringify(payload),
				},
			);

			if (!response.ok && response.status === 401) {
				customLog(
					`Unauthorized when creating/updating Patch contact for ${payload.email}, attempt ${attempt}/${retryMax}`,
					'WARN',
				);
				await Bun.sleep(delay);
			} else if (!response.ok && response.status === 429) {
				const retryAfter = response.headers.get('Retry-After');
				const waitMs = retryAfter
					? parseInt(retryAfter, 10) * 1000
					: delay * attempt;
				customLog(
					`Rate limited by Patch API when creating/updating contact for ${payload.email}. Waiting ${waitMs}ms before retry...`,
					'WARN',
				);
				await Bun.sleep(waitMs);
			} else if (!response.ok) {
				const text = await response.text();
				customLog(
					`Failed to create/update Patch contact for ${payload.email}: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
					'ERROR',
				);
				await Bun.sleep(delay);
			} else {
				const data = (await response.json()) as Record<string, unknown>;
				customLog(
					`Successfully created/updated Patch contact for ${payload.email}`,
					'INFO',
				);
				return data;
			}
		} catch (error) {
			customLog(
				`Exception when creating/updating Patch contact for ${payload.email}: ${error instanceof Error ? error.message : String(error)}`,
				'ERROR',
			);
			await Bun.sleep(delay);
		}
	}

	customLog(
		`Failed to create/update Patch contact for ${payload.email} after ${retryMax} attempts`,
		'ERROR',
	);
	return null;
}
