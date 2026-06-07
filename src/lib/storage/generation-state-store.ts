import fs from "node:fs/promises";
import { ensureDataDirs, jobChunksDir, jobsDir, safeJoin, sanitizeFilename } from "../file-utils";
import type { GenerateVoiceRequest, OutputFormat, ScriptRecord, VoiceEmotion } from "../types";

interface StoredBaseJob {
  id: string;
  scriptId: string;
  title: string;
  provider: GenerateVoiceRequest["provider"];
  format: OutputFormat;
  speed: number;
  emotion: VoiceEmotion;
  expressiveness?: number;
  voiceProfileId?: string;
  lexiconRevision?: string;
  normalizationChanges: number;
  referenceQualityScore?: number;
  referenceTranscriptUsed: boolean;
  createdAt: string;
}

export interface StoredGenerationState {
  version: 1;
  effectiveInput: GenerateVoiceRequest;
  scriptRecord: ScriptRecord;
  baseJob: StoredBaseJob;
  outputStem: string;
}

function assertJobId(jobId: string) {
  if (!/^job_[a-zA-Z0-9_-]+$/.test(jobId)) {
    throw new Error("Invalid job id");
  }
}

export function generationStatePath(jobId: string) {
  assertJobId(jobId);
  return safeJoin(jobsDir, `${jobId}.generation.json`);
}

export function generationChunkDir(jobId: string) {
  assertJobId(jobId);
  return safeJoin(jobChunksDir, jobId);
}

export async function saveGenerationState(state: StoredGenerationState) {
  await ensureDataDirs();
  await fs.mkdir(generationChunkDir(state.baseJob.id), { recursive: true });
  const safeState = {
    ...state,
    outputStem: sanitizeFilename(state.outputStem)
  } satisfies StoredGenerationState;
  await fs.writeFile(generationStatePath(state.baseJob.id), JSON.stringify(safeState, null, 2), "utf8");
  return safeState;
}

export async function readGenerationState(jobId: string) {
  await ensureDataDirs();
  const raw = await fs.readFile(generationStatePath(jobId), "utf8");
  const parsed = JSON.parse(raw) as StoredGenerationState;
  if (parsed.version !== 1 || parsed.baseJob.id !== jobId) {
    throw new Error("Invalid generation state.");
  }
  return parsed;
}

export async function deleteGenerationState(jobId: string) {
  await ensureDataDirs();
  await Promise.all([
    fs.rm(generationStatePath(jobId), { force: true }),
    fs.rm(generationChunkDir(jobId), { recursive: true, force: true })
  ]);
}
