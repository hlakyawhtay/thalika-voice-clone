import os
import re
import tempfile
import traceback
import gc
from pathlib import Path
from typing import Any

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")

import gradio as gr
import numpy as np
import soundfile as sf
import torch

from voxcpm import VoxCPM


MODEL_ID = os.environ.get("VOXCPM_MODEL_ID", "openbmb/VoxCPM2")
LOAD_DENOISER = os.environ.get("VOXCPM_LOAD_DENOISER", "false").lower() == "true"
OPTIMIZE = os.environ.get("VOXCPM_OPTIMIZE", "false").lower() == "true"
CFG_VALUE = float(os.environ.get("VOXCPM_CFG_VALUE", "2.0"))
INFERENCE_TIMESTEPS = int(os.environ.get("VOXCPM_INFERENCE_TIMESTEPS", "10"))
MAX_TEXT_CHARACTERS = int(os.environ.get("VOXCPM_MAX_TEXT_CHARACTERS", "220"))
MAX_CONTROL_CHARACTERS = int(os.environ.get("VOXCPM_MAX_CONTROL_CHARACTERS", "120"))

_model: VoxCPM | None = None


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _sample_rate(model: VoxCPM) -> int:
    tts_model = getattr(model, "tts_model", None)
    sample_rate = getattr(tts_model, "sample_rate", None)
    if isinstance(sample_rate, int) and sample_rate > 0:
        return sample_rate
    return 48_000


def _reference_path(reference_file: Any) -> str | None:
    if not reference_file:
        return None
    if isinstance(reference_file, str):
        return reference_file
    if isinstance(reference_file, dict):
        path = reference_file.get("path") or reference_file.get("name")
        return str(path) if path else None
    path = getattr(reference_file, "path", None) or getattr(reference_file, "name", None)
    return str(path) if path else None


def _load_model() -> VoxCPM:
    global _model
    if _model is not None:
        return _model

    try:
        _release_cuda_cache()
        _model = VoxCPM.from_pretrained(
            MODEL_ID,
            load_denoiser=LOAD_DENOISER,
            optimize=OPTIMIZE,
        )
    except TypeError:
        _release_cuda_cache()
        _model = VoxCPM.from_pretrained(
            MODEL_ID,
            load_denoiser=LOAD_DENOISER,
        )
    except Exception:
        _model = None
        _release_cuda_cache()
        raise

    return _model


def _release_cuda_cache() -> None:
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def _build_generation_text(text: str, control_instruction: str) -> str:
    text = text.strip()
    control_instruction = re.sub(r"[()（）]", "", control_instruction.strip())[:MAX_CONTROL_CHARACTERS]
    if not control_instruction:
        return text
    return f"({control_instruction}){text}"


def _to_numpy_audio(value: Any) -> np.ndarray:
    if isinstance(value, tuple) or isinstance(value, list):
        value = value[0]
    if isinstance(value, torch.Tensor):
        return value.squeeze().detach().cpu().float().numpy()
    return np.asarray(value).squeeze()


def _generate_audio(
    text: str,
    control_instruction: str,
    reference_file: Any,
    use_reference_transcript: bool,
    reference_text: str,
    clone_strength: float,
    normalize_text: bool,
    denoise_reference: bool,
) -> str:
    if not text or not text.strip():
        raise gr.Error("Text is required.")
    if len(text) > MAX_TEXT_CHARACTERS:
        raise gr.Error(f"Text is too long for this T4 backend. Keep each request under {MAX_TEXT_CHARACTERS} characters.")

    print(
        "generate_requested",
        {
            "text_chars": len(text),
            "control_chars": len(control_instruction or ""),
            "has_reference": bool(reference_file),
            "has_reference_text": bool(reference_text and reference_text.strip()),
            "use_reference_transcript": _truthy(use_reference_transcript),
            "normalize": _truthy(normalize_text),
            "denoise": _truthy(denoise_reference),
        },
        flush=True,
    )

    model = _load_model()
    ref_path = _reference_path(reference_file)
    prompt_text = reference_text.strip() if _truthy(use_reference_transcript) else None
    # VoxCPM2's official demo disables control instructions in transcript-guided
    # cloning mode. Keeping both can make the model speak the instruction text.
    generation_text = _build_generation_text(text, "" if prompt_text else control_instruction)

    kwargs: dict[str, Any] = {
        "target_text": generation_text,
        "cfg_value": float(clone_strength or CFG_VALUE),
        "inference_timesteps": INFERENCE_TIMESTEPS,
        "min_len": 2,
        "max_len": 2000,
    }

    if ref_path:
        kwargs["reference_wav_path"] = ref_path

    if ref_path and prompt_text:
        kwargs["prompt_wav_path"] = ref_path
        kwargs["prompt_text"] = prompt_text

    try:
        _release_cuda_cache()
        with torch.inference_mode():
            wav = model.tts_model.generate(**kwargs)
    except TypeError:
        # Older package builds may not support isolated reference cloning.
        fallback_kwargs = {
            "target_text": generation_text,
            "prompt_wav_path": ref_path if prompt_text else None,
            "prompt_text": prompt_text,
            "cfg_value": float(clone_strength or CFG_VALUE),
            "inference_timesteps": INFERENCE_TIMESTEPS,
            "min_len": 2,
            "max_len": 2000,
        }
        _release_cuda_cache()
        with torch.inference_mode():
            wav = model.tts_model.generate(**{k: v for k, v in fallback_kwargs.items() if v is not None})
    except Exception as exc:
        traceback.print_exc()
        raise gr.Error(f"VoxCPM2 generation failed: {exc}") from exc
    finally:
        _release_cuda_cache()

    output_dir = Path(tempfile.mkdtemp(prefix="thalika-voxcpm2-output-"))
    output_path = output_dir / "output.wav"
    sf.write(output_path, _to_numpy_audio(wav), _sample_rate(model))
    print("generate_completed", {"output_path": str(output_path), "sample_rate": _sample_rate(model)}, flush=True)
    return str(output_path)


def _health() -> dict[str, str]:
    return {
        "status": "ok",
        "model": MODEL_ID,
        "device": "cuda" if torch.cuda.is_available() else "cpu",
    }


with gr.Blocks(title="Thalika VoxCPM2 Backend") as demo:
    gr.Markdown("# Thalika VoxCPM2 Backend")
    gr.Markdown("Self-hosted VoxCPM2 Gradio API compatible with Thalika.")

    with gr.Row():
        text = gr.Textbox(label="Text", lines=5)
        control_instruction = gr.Textbox(label="Control instruction", lines=5)

    reference_file = gr.File(label="Reference audio", file_types=["audio"])
    use_reference_transcript = gr.Checkbox(label="Use reference transcript", value=False)
    reference_text = gr.Textbox(label="Reference transcript", lines=3)
    clone_strength = gr.Slider(label="CFG / clone strength", minimum=1.0, maximum=3.0, value=2.0, step=0.1)
    normalize_text = gr.Checkbox(label="Normalize text", value=True)
    denoise_reference = gr.Checkbox(label="Denoise reference", value=False)
    output_file = gr.File(label="Generated WAV")

    generate_button = gr.Button("Generate")
    generate_button.click(
        _generate_audio,
        inputs=[
            text,
            control_instruction,
            reference_file,
            use_reference_transcript,
            reference_text,
            clone_strength,
            normalize_text,
            denoise_reference,
        ],
        outputs=output_file,
        api_name="generate",
    )

    demo.load(_health, outputs=gr.JSON(visible=False), api_name="health")


if __name__ == "__main__":
    demo.queue(default_concurrency_limit=1).launch(
        server_name=os.environ.get("GRADIO_SERVER_NAME", "0.0.0.0"),
        server_port=int(os.environ.get("PORT", "7860")),
        show_error=True,
        ssr_mode=False,
    )
