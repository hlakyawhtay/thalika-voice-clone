export const MAX_SCRIPT_CHARACTERS = 50000;

export const DEFAULT_REMOTE_TTS_CHUNK_CHARACTERS = 220;

export function getRemoteTtsChunkCharacters() {
  const value =
    typeof process === "undefined"
      ? undefined
      : process.env.VOXCPM_MAX_TEXT_CHARACTERS || process.env.REMOTE_TTS_CHUNK_CHARACTERS;
  const parsed = Number(value || DEFAULT_REMOTE_TTS_CHUNK_CHARACTERS);
  if (!Number.isFinite(parsed)) return DEFAULT_REMOTE_TTS_CHUNK_CHARACTERS;
  return Math.min(1000, Math.max(80, Math.floor(parsed)));
}
