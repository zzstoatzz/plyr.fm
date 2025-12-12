#!/usr/bin/env python3
"""generate ES256 JWK for OAuth confidential client.

outputs a JSON string suitable for the OAUTH_JWK environment variable.

usage:
    uv run python scripts/gen_oauth_jwk.py

then add to your .env:
    OAUTH_JWK='{"kty":"EC","crv":"P-256",...}'
"""

import json
import time

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from jose import jwk


def generate_jwk() -> str:
    """generate ES256 (P-256) JWK for OAuth client authentication."""
    # generate P-256 (secp256r1) key pair
    private_key = ec.generate_private_key(ec.SECP256R1())

    # serialize to PEM
    pem_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    # convert to JWK using python-jose
    key_obj = jwk.construct(pem_bytes, algorithm="ES256")
    jwk_dict = key_obj.to_dict()

    # add key ID based on timestamp (for key rotation)
    jwk_dict["kid"] = str(int(time.time()))
    jwk_dict["use"] = "sig"
    jwk_dict["alg"] = "ES256"

    return json.dumps(jwk_dict)


if __name__ == "__main__":
    jwk_json = generate_jwk()
    print("generated ES256 JWK for OAuth confidential client:\n")
    print(jwk_json)
    print("\nadd to your .env file as:")
    print(f"OAUTH_JWK='{jwk_json}'")
