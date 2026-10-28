declare module "*.txt" {
	const text: string;
	export default text;
}

interface Env {
	DEEPGRAM_API_KEY: string;
	ACCESS_TOKENS: string;
	HOT_DAYS?: string;
	ARCHIVE?: R2Bucket;
	DEEPGRAM_URL: string;
	TRANSCRIPTS: DurableObjectNamespace<import("./src/store").Transcripts>;
}
