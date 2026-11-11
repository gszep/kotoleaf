declare module "*.txt" {
	const text: string;
	export default text;
}
declare module "*.html" {
	const text: string;
	export default text;
}

interface Env {
	CF_VERSION_METADATA: WorkerVersionMetadata;
	DEEPGRAM_API_KEY: string;
	ACCESS_TOKENS: string;
	/** Dedicated, transcription-only credential for the chat bridge. */
	OPENCODE_CHAT_TOKEN?: string;
	HOT_DAYS?: string;
	ARCHIVE?: R2Bucket;
	DEEPGRAM_URL: string;
	TRANSCRIPTS: DurableObjectNamespace<import("./src/store").Transcripts>;
}
