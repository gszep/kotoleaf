// Weekly archive: every Sunday 03:00 Asia/Tokyo (Saturday 18:00 UTC), meetings
// that started more than HOT_DAYS ago move from the Durable Object to R2.

const DAY_MS = 86_400_000;
const SUNDAY_0300_JST_UTC_HOUR = 18; // Saturday 18:00 UTC
const SATURDAY = 6;

export function nextArchiveTime(now: number): number {
	const d = new Date(now);
	const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), SUNDAY_0300_JST_UTC_HOUR);
	const daysAhead = (SATURDAY - d.getUTCDay() + 7) % 7;
	let next = target + daysAhead * DAY_MS;
	if (next <= now) next += 7 * DAY_MS;
	return next;
}

export function archiveCutoff(now: number, hotDays: number): number {
	return now - hotDays * DAY_MS;
}
