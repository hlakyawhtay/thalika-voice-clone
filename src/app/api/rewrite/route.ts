import { NextResponse } from "next/server";
import { z } from "zod";
import {
  GEMINI_REWRITE_MODELS,
  type GeminiRewriteModel
} from "@/lib/script-rewrite";
import { getGeminiApiKey } from "@/lib/storage/env-store";

export const runtime = "nodejs";

const requestSchema = z.object({
  title: z.string().trim().max(100).optional().or(z.literal("")),
  script: z
    .string()
    .trim()
    .min(10, "Script must be at least 10 characters"),
  model: z.enum(GEMINI_REWRITE_MODELS.map((item) => item.id) as [GeminiRewriteModel, ...GeminiRewriteModel[]]),
  keepBurmese: z.boolean().optional()
});

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

class GeminiTimeoutError extends Error {
  constructor() {
    super("Gemini request timed out.");
    this.name = "GeminiTimeoutError";
  }
}

function getGeminiRequestTimeout() {
  const parsed = Number(process.env.GEMINI_REQUEST_TIMEOUT || 60000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
}

async function fetchGeminiWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getGeminiRequestTimeout());

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const GEMINI_REWRITE_CHUNK_CHARACTERS = 12000;

function splitRewriteInput(script: string) {
  const normalized = script.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= GEMINI_REWRITE_CHUNK_CHARACTERS) return [normalized];

  const pieces = normalized
    .split(/(\n{2,}|(?<=[။၊.!?])\s+)/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length <= GEMINI_REWRITE_CHUNK_CHARACTERS) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);

    if (piece.length <= GEMINI_REWRITE_CHUNK_CHARACTERS) {
      current = piece;
      continue;
    }

    for (let start = 0; start < piece.length; start += GEMINI_REWRITE_CHUNK_CHARACTERS) {
      chunks.push(piece.slice(start, start + GEMINI_REWRITE_CHUNK_CHARACTERS).trim());
    }
    current = "";
  }

  if (current) chunks.push(current);
  return chunks;
}

function buildPrompt(input: z.infer<typeof requestSchema>, script: string, chunkIndex: number, chunkCount: number) {
  const languageInstruction = input.keepBurmese ?? true
    ? "Keep the rewritten script in Burmese/Myanmar language. Do not translate it into English."
    : "Keep the original language unless the text clearly asks for another language.";
  const chunkInstruction =
    chunkCount > 1
      ? `This is chapter rewrite segment ${chunkIndex + 1} of ${chunkCount}. Rewrite only this segment and preserve continuity with the surrounding chapter. Do not summarize or skip any content.`
      : "";

  return [
    "You are a senior narration script editor for a professional voice-over studio.",
    "Convert the user's original script into a narration-ready reading script.",
    chunkInstruction,
    languageInstruction,
    "Do not change the story, category, facts, names, numbers, claims, message, or intent.",
    "Do not add documentary, warm story, brand, social, or any other separate style category.",
    "Do not add headings, markdown, bullet points, explanations, scene labels, speaker labels, or bracketed directions that a TTS engine might read aloud.",
    "Only polish it for spoken delivery: add natural pauses using punctuation, short sentence breaks, ellipses where useful, smoother breath points, and clearer emphasis through wording and rhythm.",
    "Use punctuation and line breaks to suggest voice rise/fall and pacing. Keep the output clean enough to paste directly into a TTS voice-over generator.",
    "Avoid making it much longer than the original. Output only the final narration-ready script.",
    input.title ? `Title context: ${input.title}` : "",
    "Original script:",
    script
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function callGeminiChunk(input: z.infer<typeof requestSchema>, script: string, chunkIndex: number, chunkCount: number) {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key is not configured. Add GEMINI_API_KEY to .env.local, then restart the app.");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchGeminiWithTimeout(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: buildPrompt(input, script, chunkIndex, chunkCount) }]
        }
      ],
      generationConfig: {
        temperature: 0.45,
        topP: 0.9,
        maxOutputTokens: 8192
      }
    })
  });

  let json: GeminiResponse;
  try {
    json = (await response.json()) as GeminiResponse;
  } catch {
    throw new Error("Gemini returned a response the app could not parse.");
  }

  if (!response.ok) {
    throw new Error(json.error?.message || "Gemini returned an error.");
  }

  const rewrittenScript = json.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!rewrittenScript) {
    throw new Error("Gemini returned an empty rewrite. Try a different model or shorten this chunk.");
  }

  return rewrittenScript;
}

async function callGemini(input: z.infer<typeof requestSchema>) {
  const chunks = splitRewriteInput(input.script);
  const rewrittenChunks: string[] = [];

  for (const [index, chunk] of chunks.entries()) {
    rewrittenChunks.push(await callGeminiChunk(input, chunk, index, chunks.length));
  }

  const rewrittenScript = rewrittenChunks.join("\n\n").trim();
  return NextResponse.json({
    status: "completed",
    title: input.title || "Narration Rewrite",
    originalCharacterCount: input.script.length,
    rewrittenCharacterCount: rewrittenScript.length,
    model: input.model,
    chunks: chunks.length,
    rewrittenScript
  });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "failed", error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "failed", error: parsed.error.issues.map((issue) => issue.message).join(". ") },
      { status: 400 }
    );
  }

  try {
    return await callGemini(parsed.data);
  } catch (error) {
    if (error instanceof GeminiTimeoutError) {
      return NextResponse.json(
        {
          status: "failed",
          error: "Gemini script rewrite timed out.",
          message: "Gemini took too long to respond. Try a shorter script or increase GEMINI_REQUEST_TIMEOUT."
        },
        { status: 504 }
      );
    }

    return NextResponse.json(
      {
        status: "failed",
        error: "Gemini script rewrite failed.",
        message: error instanceof Error ? error.message : "Could not rewrite the script."
      },
      { status: 500 }
    );
  }
}
