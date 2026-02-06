"""CLAP embedding service on Modal.

Hosts the CLAP (Contrastive Language-Audio Pretraining) model for generating
audio and text embeddings in a shared vector space. Used by plyr.fm for
semantic vibe search — users describe a mood and get matching tracks.

deploy:
    modal deploy clap/app.py

test:
    curl -X POST https://<modal-url>/embed_text \
        -H "Content-Type: application/json" \
        -d '{"text": "dark ambient techno"}'
"""

import base64
import io

import modal

app = modal.App("plyr-clap")

clap_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "transformers>=4.40.0",
        "torch>=2.2.0",
        "librosa>=0.10.0",
        "numpy>=1.26.0",
        "soundfile>=0.12.0",
    )
)


@app.cls(
    image=clap_image,
    scaledown_window=300,
    cpu=2.0,
    memory=4096,
)
class ClapService:
    """CLAP model service for audio and text embedding."""

    @modal.enter()
    def load_model(self):
        from transformers import ClapModel, ClapProcessor

        self.model = ClapModel.from_pretrained("laion/larger_clap_music")
        self.processor = ClapProcessor.from_pretrained("laion/larger_clap_music")
        self.model.eval()
        self.device = "cpu"

    @modal.fastapi_endpoint(method="POST")
    def embed_audio(self, item: dict) -> dict:
        """generate embedding from base64-encoded audio bytes.

        expects: {"audio_b64": "<base64 string>"}
        returns: {"embedding": [float, ...], "dimensions": 512}
        """
        import subprocess
        import tempfile
        import traceback

        import soundfile as sf
        import torch

        if not (audio_b64 := item.get("audio_b64")):
            return {"error": "missing audio_b64 field"}

        try:
            audio_bytes = base64.b64decode(audio_b64)

            # try soundfile first (handles wav, flac, ogg natively)
            try:
                audio_array, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
            except Exception:
                # fall back to ffmpeg for m4a/aac/other formats
                with tempfile.NamedTemporaryFile(suffix=".audio", delete=True) as tmp:
                    tmp.write(audio_bytes)
                    tmp.flush()
                    result = subprocess.run(
                        [
                            "ffmpeg",
                            "-i",
                            tmp.name,
                            "-f",
                            "wav",
                            "-acodec",
                            "pcm_f32le",
                            "-ac",
                            "1",
                            "-ar",
                            "48000",
                            "-v",
                            "error",
                            "pipe:1",
                        ],
                        capture_output=True,
                    )
                    if result.returncode != 0:
                        return {
                            "error": f"ffmpeg failed: {result.stderr.decode()[:500]}"
                        }
                    audio_array, sr = sf.read(
                        io.BytesIO(result.stdout), dtype="float32"
                    )

            # convert to mono if stereo
            if audio_array.ndim > 1:
                audio_array = audio_array.mean(axis=1)

            # resample to 48kHz if needed
            if sr != 48000:
                import librosa

                audio_array = librosa.resample(audio_array, orig_sr=sr, target_sr=48000)
                sr = 48000

            # CLAP works best with ~10s chunks; take the first 30s max
            max_samples = 30 * sr
            if len(audio_array) > max_samples:
                audio_array = audio_array[:max_samples]

            inputs = self.processor(
                audio=[audio_array],
                sampling_rate=sr,
                return_tensors="pt",
            )

            with torch.no_grad():
                audio_output = self.model.audio_model(
                    input_features=inputs["input_features"],
                    is_longer=inputs.get("is_longer"),
                )
                projected = self.model.audio_projection(audio_output.pooler_output)
                normalized = torch.nn.functional.normalize(projected, dim=-1)

            embedding = normalized[0].cpu().numpy().tolist()

            return {
                "embedding": embedding,
                "dimensions": len(embedding),
            }
        except Exception:
            return {"error": traceback.format_exc()[-1000:]}

    @modal.fastapi_endpoint(method="POST")
    def embed_text(self, item: dict) -> dict:
        """generate embedding from text description.

        expects: {"text": "dark ambient techno"}
        returns: {"embedding": [float, ...], "dimensions": 512}
        """
        import torch

        if not (text := item.get("text")):
            return {"error": "missing text field"}

        inputs = self.processor(
            text=[text],
            return_tensors="pt",
            padding=True,
        )

        with torch.no_grad():
            text_output = self.model.text_model(**inputs)
            projected = self.model.text_projection(text_output.pooler_output)
            normalized = torch.nn.functional.normalize(projected, dim=-1)

        embedding = normalized[0].cpu().numpy().tolist()

        return {
            "embedding": embedding,
            "dimensions": len(embedding),
        }
