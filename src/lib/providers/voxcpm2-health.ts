import { fetchWithTimeout, getHFHeaders, getHFRequestTimeout, readJsonResponse, TimeoutError } from "./hf-utils";

export type VoxCPM2HealthStatus =
  | "connected"
  | "timeout"
  | "rate_limited"
  | "unavailable"
  | "invalid_response"
  | "misconfigured";

export interface VoxCPM2Health {
  provider: "voxcpm2";
  backend: "huggingface-space";
  ok: boolean;
  status: VoxCPM2HealthStatus;
  baseUrl: string;
  endpoint: string;
  latencyMs: number;
  timeoutMs: number;
  message: string;
  checkedAt: string;
}

const demoVoxCPM2SpaceUrl = "https://openbmb-voxcpm-demo.hf.space";

export class VoxCPM2ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoxCPM2ConfigError";
  }
}

export function getVoxCPM2BaseUrl() {
  const configuredUrl = process.env.HF_VOXCPM2_URL?.trim();
  const normalizedUrl = configuredUrl?.replace(/\/+$/, "");

  if (process.env.NODE_ENV === "production" && normalizedUrl === demoVoxCPM2SpaceUrl) {
    throw new VoxCPM2ConfigError("The public VoxCPM2 demo Space must not be used in production.");
  }

  if (normalizedUrl) return normalizedUrl;

  if (process.env.NODE_ENV === "production") {
    throw new VoxCPM2ConfigError("HF_VOXCPM2_URL must be configured for production.");
  }

  return demoVoxCPM2SpaceUrl;
}

function makeHealth(
  status: VoxCPM2HealthStatus,
  options: {
    baseUrl: string;
    endpoint: string;
    latencyMs: number;
    message: string;
  }
): VoxCPM2Health {
  return {
    provider: "voxcpm2",
    backend: "huggingface-space",
    ok: status === "connected",
    status,
    baseUrl: options.baseUrl,
    endpoint: options.endpoint,
    latencyMs: options.latencyMs,
    timeoutMs: getHFRequestTimeout(),
    message: options.message,
    checkedAt: new Date().toISOString()
  };
}

function hasNamedGenerateEndpoint(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const namedEndpoints = record.named_endpoints;
  if (!namedEndpoints || typeof namedEndpoints !== "object") return false;
  return "/generate" in namedEndpoints;
}

function hasConfigGenerateEndpoint(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const dependencies = (value as Record<string, unknown>).dependencies;
  if (!Array.isArray(dependencies)) return false;

  return dependencies.some((dependency) => {
    if (!dependency || typeof dependency !== "object") return false;
    return (dependency as Record<string, unknown>).api_name === "generate";
  });
}

async function probeJson(baseUrl: string, endpoint: string) {
  const startedAt = Date.now();
  const response = await fetchWithTimeout(`${baseUrl}${endpoint}`, {
    method: "GET",
    headers: getHFHeaders({ Accept: "application/json" }),
    cache: "no-store"
  });
  const latencyMs = Date.now() - startedAt;

  if (response.status === 429) {
    return makeHealth("rate_limited", {
      baseUrl,
      endpoint,
      latencyMs,
      message: "Public Hugging Face Space is rate limited."
    });
  }

  if (response.status === 503) {
    return makeHealth("unavailable", {
      baseUrl,
      endpoint,
      latencyMs,
      message: "Hugging Face Space is currently unavailable."
    });
  }

  if (!response.ok) {
    return makeHealth("unavailable", {
      baseUrl,
      endpoint,
      latencyMs,
      message: `Hugging Face Space returned HTTP ${response.status}.`
    });
  }

  try {
    const json = await readJsonResponse<unknown>(response, "Invalid response from VoxCPM2 Space.");
    return { json, latencyMs };
  } catch {
    return makeHealth("invalid_response", {
      baseUrl,
      endpoint,
      latencyMs,
      message: "Invalid response from VoxCPM2 Space."
    });
  }
}

export async function checkVoxCPM2Health(): Promise<VoxCPM2Health> {
  let baseUrl = "";

  try {
    baseUrl = getVoxCPM2BaseUrl();
  } catch (error) {
    if (error instanceof VoxCPM2ConfigError) {
      return makeHealth("misconfigured", {
        baseUrl,
        endpoint: "",
        latencyMs: 0,
        message: "Production requires a private VoxCPM2 backend. Use a private Space, HF Inference Endpoint, or self-hosted backend instead of the public demo Space."
      });
    }

    throw error;
  }

  try {
    const info = await probeJson(baseUrl, "/gradio_api/info");
    if ("status" in info) return info;
    if (hasNamedGenerateEndpoint(info.json)) {
      return makeHealth("connected", {
        baseUrl,
        endpoint: "/gradio_api/info",
        latencyMs: info.latencyMs,
        message: "VoxCPM2 Hugging Face Space is connected and exposes /generate."
      });
    }

    const config = await probeJson(baseUrl, "/config");
    if ("status" in config) return config;
    if (hasConfigGenerateEndpoint(config.json)) {
      return makeHealth("connected", {
        baseUrl,
        endpoint: "/config",
        latencyMs: config.latencyMs,
        message: "VoxCPM2 Hugging Face Space is connected and exposes generate."
      });
    }

    return makeHealth("invalid_response", {
      baseUrl,
      endpoint: "/gradio_api/info",
      latencyMs: info.latencyMs,
      message: "Invalid response from VoxCPM2 Space."
    });
  } catch (error) {
    if (error instanceof TimeoutError) {
      return makeHealth("timeout", {
        baseUrl,
        endpoint: "/gradio_api/info",
        latencyMs: getHFRequestTimeout(),
        message: "Remote inference timed out."
      });
    }

    return makeHealth("unavailable", {
      baseUrl,
      endpoint: "/gradio_api/info",
      latencyMs: 0,
      message: "Hugging Face Space is currently unavailable."
    });
  }
}
