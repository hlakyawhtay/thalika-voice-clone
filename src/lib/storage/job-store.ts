import fs from "node:fs/promises";
import { ensureDataDirs, idStamp, localIsoString, readMarkdownFiles, safeJoin, jobsDir, outputsDir } from "../file-utils";
import { parseMarkdown, serializeMarkdown, toNumber } from "../markdown-utils";
import type { JobRecord, JobStatus, OutputFormat, VoiceEmotion } from "../types";
import { deleteGenerationState } from "./generation-state-store";
import { deleteListeningReview, readListeningReview } from "./listening-review-store";

export function createJobId() {
  return `job_${idStamp()}`;
}

function assertJobId(jobId: string) {
  if (!/^job_[a-zA-Z0-9_-]+$/.test(jobId)) {
    throw new Error("Invalid job id");
  }
}

function jobMarkdownPath(jobId: string) {
  assertJobId(jobId);
  return safeJoin(jobsDir, `${jobId}.md`);
}

function jobCancelPath(jobId: string) {
  assertJobId(jobId);
  return safeJoin(jobsDir, `${jobId}.cancel`);
}

export async function saveJob(record: Omit<JobRecord, "createdAt"> & { createdAt?: string }) {
  await ensureDataDirs();
  const job: JobRecord = {
    ...record,
    createdAt: record.createdAt || localIsoString()
  };
  const markdown = serializeMarkdown(
    {
      id: job.id,
      scriptId: job.scriptId,
      title: job.title,
      provider: job.provider,
      format: job.format,
      speed: job.speed,
      emotion: job.emotion,
      expressiveness: job.expressiveness,
      status: job.status,
      audioFile: job.audioFile,
      error: job.error,
      completedChunks: job.completedChunks,
      totalChunks: job.totalChunks,
      progressMessage: job.progressMessage,
      voiceProfileId: job.voiceProfileId,
      lexiconRevision: job.lexiconRevision,
      normalizationChanges: job.normalizationChanges,
      referenceQualityScore: job.referenceQualityScore,
      referenceTranscriptUsed: job.referenceTranscriptUsed,
      createdAt: job.createdAt
    },
    job.content
  );

  await fs.writeFile(safeJoin(jobsDir, `${job.id}.md`), markdown, "utf8");
  return job;
}

function parseJobMarkdown(content: string) {
  const parsed = parseMarkdown(content);
  const parsedStatus = parsed.frontmatter.status as JobStatus | undefined;
  const status: JobStatus =
    parsedStatus === "failed" || parsedStatus === "generating" || parsedStatus === "canceled"
      ? parsedStatus
      : "completed";
  return {
    id: parsed.frontmatter.id || "",
    scriptId: parsed.frontmatter.scriptId || "",
    title: parsed.frontmatter.title || "Untitled Script",
    provider: parsed.frontmatter.provider || "unknown",
    format: (parsed.frontmatter.format || "wav") as OutputFormat,
    speed: toNumber(parsed.frontmatter.speed, 1),
    emotion: (parsed.frontmatter.emotion || "neutral") as VoiceEmotion,
    expressiveness: toNumber(parsed.frontmatter.expressiveness, 0.7),
    status,
    audioFile: parsed.frontmatter.audioFile,
    error: parsed.frontmatter.error,
    completedChunks: toNumber(parsed.frontmatter.completedChunks, 0),
    totalChunks: toNumber(parsed.frontmatter.totalChunks, 0),
    progressMessage: parsed.frontmatter.progressMessage,
    voiceProfileId: parsed.frontmatter.voiceProfileId,
    lexiconRevision: parsed.frontmatter.lexiconRevision,
    normalizationChanges: toNumber(parsed.frontmatter.normalizationChanges, 0),
    referenceQualityScore: toNumber(parsed.frontmatter.referenceQualityScore, 0),
    referenceTranscriptUsed: parsed.frontmatter.referenceTranscriptUsed === "true",
    createdAt: parsed.frontmatter.createdAt || "",
    content: parsed.body
  } satisfies JobRecord;
}

export async function getJob(jobId: string) {
  await ensureDataDirs();
  assertJobId(jobId);

  const markdown = await fs.readFile(jobMarkdownPath(jobId), "utf8");
  const job = parseJobMarkdown(markdown);
  return { ...job, review: await readListeningReview(job.id) };
}

export async function listJobs(limit = 20) {
  const files = await readMarkdownFiles(jobsDir);
  const jobs = files
    .map(({ content }) => parseJobMarkdown(content))
    .filter((job) => job.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  return Promise.all(jobs.map(async (job) => ({ ...job, review: await readListeningReview(job.id) })));
}

export async function deleteJob(jobId: string) {
  await ensureDataDirs();
  assertJobId(jobId);

  const jobFilePath = jobMarkdownPath(jobId);
  const markdown = await fs.readFile(jobFilePath, "utf8");
  const parsed = parseMarkdown(markdown);
  const audioFile = parsed.frontmatter.audioFile;

  await fs.unlink(jobFilePath);
  await deleteListeningReview(jobId);
  await fs.rm(jobCancelPath(jobId), { force: true });
  await deleteGenerationState(jobId);

  let audioDeleted = false;
  if (audioFile) {
    try {
      await fs.unlink(safeJoin(outputsDir, audioFile));
      audioDeleted = true;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }

  return {
    jobId,
    audioFile,
    audioDeleted
  };
}

export async function requestJobCancellation(jobId: string) {
  await ensureDataDirs();
  assertJobId(jobId);
  const job = await getJob(jobId);

  if (job.status !== "generating") {
    return { job, cancelable: false };
  }

  await fs.writeFile(jobCancelPath(jobId), localIsoString(), "utf8");
  const canceled = await saveJob({
    id: job.id,
    scriptId: job.scriptId,
    title: job.title,
    provider: job.provider,
    format: job.format,
    speed: job.speed,
    emotion: job.emotion,
    expressiveness: job.expressiveness,
    status: "canceled",
    audioFile: job.audioFile,
    error: "Generation canceled.",
    completedChunks: job.completedChunks,
    totalChunks: job.totalChunks,
    progressMessage: "Generation canceled.",
    voiceProfileId: job.voiceProfileId,
    lexiconRevision: job.lexiconRevision,
    normalizationChanges: job.normalizationChanges,
    referenceQualityScore: job.referenceQualityScore,
    referenceTranscriptUsed: job.referenceTranscriptUsed,
    createdAt: job.createdAt,
    content: "Generation was canceled before audio output was completed."
  });

  return { job: canceled, cancelable: true };
}

export async function isJobCancellationRequested(jobId: string) {
  await ensureDataDirs();
  assertJobId(jobId);
  try {
    await fs.access(jobCancelPath(jobId));
    return true;
  } catch {
    return false;
  }
}

export async function clearJobCancellation(jobId: string) {
  await ensureDataDirs();
  assertJobId(jobId);
  await fs.rm(jobCancelPath(jobId), { force: true });
}
