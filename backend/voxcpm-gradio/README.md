---
title: Thalika VoxCPM2 Backend
emoji: 🎙️
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: "6.13.0"
python_version: "3.10"
app_file: app.py
startup_duration_timeout: 1h
models:
  - openbmb/VoxCPM2
tags:
  - text-to-speech
  - voice-cloning
  - burmese
  - gradio
short_description: Self-hosted VoxCPM2 Gradio backend for Thalika.
---

# Thalika VoxCPM2 Backend

This backend is a self-hosted Gradio Space for Thalika. It exposes the same Gradio API shape that the app already calls:

- `POST /gradio_api/upload`
- `POST /gradio_api/call/generate`
- `GET /gradio_api/call/generate/{event_id}`
- `GET /gradio_api/info`

It does not use `NANOVLLM_API_BASE`. The VoxCPM2 model runs inside this backend process.

## Hugging Face Space

Create a new Hugging Face Space:

- SDK: `Gradio`
- Visibility: `Protected` or `Private`
- Hardware: `Nvidia T4 medium` or better

Upload these files from this folder to the Space:

- `app.py`
- `requirements.txt`
- `packages.txt`
- `README.md`

Set Space variables if needed:

```bash
VOXCPM_MODEL_ID=openbmb/VoxCPM2
VOXCPM_LOAD_DENOISER=false
VOXCPM_OPTIMIZE=false
VOXCPM_CFG_VALUE=2.0
VOXCPM_INFERENCE_TIMESTEPS=10
VOXCPM_MAX_TEXT_CHARACTERS=220
VOXCPM_MAX_CONTROL_CHARACTERS=120
PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
TORCHDYNAMO_DISABLE=1
```

This Space uses Gradio 6 because current VoxCPM2 depends on `gradio>=6,<7`.

After the Space is running, set Thalika to the Space app URL:

```bash
HF_VOXCPM2_URL=https://your-username-your-space-name.hf.space
```

## Local Run

Use Python 3.10+ with CUDA if you want usable performance.

```bash
cd backend/voxcpm-gradio
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then configure Thalika:

```bash
HF_VOXCPM2_URL=http://127.0.0.1:7860
```

## Notes

VoxCPM2 is a large TTS model. CPU can be very slow. If generation returns no audio or the Space restarts, check the Space logs for CUDA memory, quota, missing dependency, or model download errors.

`Nvidia T4 medium` is tight for VoxCPM2. Keep `VOXCPM_MAX_TEXT_CHARACTERS` at `220` or lower, keep `VOXCPM_LOAD_DENOISER=false`, keep `VOXCPM_OPTIMIZE=false`, and use short reference audio. If CUDA out-of-memory still occurs, use `L4` or `A10G`.
