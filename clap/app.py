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

clap_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "transformers>=4.40.0",
    "torch>=2.2.0",
    "librosa>=0.10.0",
    "numpy>=1.26.0",
    "soundfile>=0.12.0",
)


@app.cls(
    image=clap_image,
    container_idle_timeout=300,
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

    @modal.web_endpoint(method="POST")
    def embed_audio(self, item: dict) -> dict:
        """generate embedding from base64-encoded audio bytes.

        expects: {"audio_b64": "<base64 string>"}
        returns: {"embedding": [float, ...], "dimensions": 512}
        """
        import librosa
        import torch

        if not (audio_b64 := item.get("audio_b64")):
            return {"error": "missing audio_b64 field"}

        audio_bytes = base64.b64decode(audio_b64)

        # load audio at 48kHz (CLAP's expected sample rate)
        audio_array, sr = librosa.load(io.BytesIO(audio_bytes), sr=48000, mono=True)

        # CLAP works best with ~10s chunks; take the first 30s max
        max_samples = 30 * sr
        if len(audio_array) > max_samples:
            audio_array = audio_array[:max_samples]

        inputs = self.processor(
            audios=[audio_array],
            sampling_rate=sr,
            return_tensors="pt",
        )

        with torch.no_grad():
            audio_embed = self.model.get_audio_features(**inputs)

        embedding = audio_embed[0].cpu().numpy().tolist()

        return {
            "embedding": embedding,
            "dimensions": len(embedding),
        }

    @modal.web_endpoint(method="POST")
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
            text_embed = self.model.get_text_features(**inputs)

        embedding = text_embed[0].cpu().numpy().tolist()

        return {
            "embedding": embedding,
            "dimensions": len(embedding),
        }
