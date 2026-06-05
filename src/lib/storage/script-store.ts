import fs from "node:fs/promises";
import { ensureDataDirs, idStamp, localIsoString, readMarkdownFiles, safeJoin, scriptsDir, wordCount } from "../file-utils";
import { parseMarkdown, serializeMarkdown, toNumber } from "../markdown-utils";
import type { ScriptGenerationStatus, ScriptRecord } from "../types";
import { getJob } from "./job-store";

type ScriptKind = NonNullable<ScriptRecord["kind"]>;

function assertScriptId(id: string) {
  if (!/^script_[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid script id");
  }
}

function scriptPath(id: string) {
  assertScriptId(id);
  return safeJoin(scriptsDir, `${id}.md`);
}

function parseScriptMarkdown(content: string) {
  const parsed = parseMarkdown(content);
  const kind = parsed.frontmatter.kind === "snapshot" ? "snapshot" : "chapter";
  return {
    id: parsed.frontmatter.id || "",
    title: parsed.frontmatter.title || "Untitled Chapter",
    createdAt: parsed.frontmatter.createdAt || "",
    updatedAt: parsed.frontmatter.updatedAt || parsed.frontmatter.createdAt || "",
    order: toNumber(parsed.frontmatter.order, 0),
    characterCount: toNumber(parsed.frontmatter.characterCount),
    wordCount: toNumber(parsed.frontmatter.wordCount),
    content: parsed.body,
    kind,
    generationStatus: (parsed.frontmatter.generationStatus || "idle") as ScriptGenerationStatus,
    jobId: parsed.frontmatter.jobId,
    audioFile: parsed.frontmatter.audioFile,
    error: parsed.frontmatter.error,
    completedChunks: toNumber(parsed.frontmatter.completedChunks, 0),
    totalChunks: toNumber(parsed.frontmatter.totalChunks, 0),
    progressMessage: parsed.frontmatter.progressMessage
  } satisfies ScriptRecord;
}

function serializeScript(record: ScriptRecord) {
  return serializeMarkdown(
    {
      id: record.id,
      title: record.title,
      kind: record.kind || "chapter",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      order: record.order,
      characterCount: record.characterCount,
      wordCount: record.wordCount,
      generationStatus: record.generationStatus,
      jobId: record.jobId,
      audioFile: record.audioFile,
      error: record.error,
      completedChunks: record.completedChunks,
      totalChunks: record.totalChunks,
      progressMessage: record.progressMessage
    },
    record.content
  );
}

async function writeScript(record: ScriptRecord) {
  await fs.writeFile(scriptPath(record.id), serializeScript(record), "utf8");
  return record;
}

async function enrichWithJob(record: ScriptRecord) {
  if (!record.jobId) return record;

  try {
    const job = await getJob(record.jobId);
    return {
      ...record,
      generationStatus: job.status,
      audioFile: job.audioFile,
      error: job.error,
      completedChunks: job.completedChunks,
      totalChunks: job.totalChunks,
      progressMessage: job.progressMessage
    } satisfies ScriptRecord;
  } catch {
    return record;
  }
}

export async function saveScript(input: { title?: string; script: string; kind?: ScriptKind; order?: number }) {
  await ensureDataDirs();
  const createdAt = localIsoString();
  const id = `script_${idStamp()}`;
  const content = input.script.trim();
  const record: ScriptRecord = {
    id,
    title: input.title?.trim() || (input.kind === "snapshot" ? "Untitled Script" : "Untitled Chapter"),
    createdAt,
    updatedAt: createdAt,
    order: input.order,
    characterCount: content.length,
    wordCount: wordCount(content),
    content,
    kind: input.kind || "chapter",
    generationStatus: "idle"
  };

  await writeScript(record);
  return record;
}

export async function updateScript(input: { id: string; title?: string; script?: string; order?: number }) {
  await ensureDataDirs();
  const current = await getScriptById(input.id);
  const nextContent = input.script !== undefined ? input.script.trim() : current.content;
  const contentChanged = nextContent !== current.content;
  const updatedAt = localIsoString();
  const next: ScriptRecord = {
    ...current,
    title: input.title !== undefined ? input.title.trim() || "Untitled Chapter" : current.title,
    updatedAt,
    order: input.order !== undefined ? input.order : current.order,
    characterCount: nextContent.length,
    wordCount: wordCount(nextContent),
    content: nextContent,
    ...(contentChanged
      ? {
          generationStatus: "idle" as const,
          jobId: undefined,
          audioFile: undefined,
          error: undefined,
          completedChunks: 0,
          totalChunks: 0,
          progressMessage: undefined
        }
      : {})
  };
  return writeScript(next);
}

export async function updateScriptGenerationState(
  id: string,
  state: Partial<
    Pick<
      ScriptRecord,
      "generationStatus" | "jobId" | "audioFile" | "error" | "completedChunks" | "totalChunks" | "progressMessage"
    >
  >
) {
  await ensureDataDirs();
  const current = await getScriptById(id);
  return writeScript({
    ...current,
    ...state,
    updatedAt: localIsoString()
  });
}

export async function listScripts(limit = 200) {
  const files = await readMarkdownFiles(scriptsDir);
  const scripts = files
    .map(({ content }) => parseScriptMarkdown(content))
    .filter((script) => script.id && script.kind !== "snapshot")
    .sort((a, b) => {
      const orderDelta = (a.order || 0) - (b.order || 0);
      if (orderDelta !== 0) return orderDelta;
      return a.createdAt.localeCompare(b.createdAt);
    })
    .slice(0, limit);

  return Promise.all(scripts.map((script) => enrichWithJob(script)));
}

export async function getScriptById(id: string) {
  await ensureDataDirs();
  const file = await fs.readFile(scriptPath(id), "utf8");
  return parseScriptMarkdown(file);
}

export async function deleteScript(id: string) {
  await ensureDataDirs();
  await fs.unlink(scriptPath(id));
  return { id };
}
