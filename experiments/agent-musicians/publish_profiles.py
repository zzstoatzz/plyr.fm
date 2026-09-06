"""Publish chosen identities while preserving the standard bot self-label."""

# /// script
# requires-python = ">=3.13"
# dependencies = ["prefect==3.8.2", "httpx>=0.27,<1"]
# ///
import json

import httpx
from launch import API, ROOT, checked, credentials


def main() -> None:
    with httpx.Client(timeout=60) as c:
        for name in ("moss", "kite", "reed"):
            entry = credentials(name)
            profile = json.loads((ROOT / "profiles" / f"{name}.json").read_text())[
                "profile"
            ]
            xrpc = entry["pds"] + "/xrpc/"
            session = checked(
                c.post(
                    xrpc + "com.atproto.server.createSession",
                    json={"identifier": entry["handle"], "password": entry["password"]},
                )
            ).json()
            headers = {"Authorization": "Bearer " + session["accessJwt"]}
            params = {
                "repo": entry["did"],
                "collection": "app.bsky.actor.profile",
                "rkey": "self",
            }
            current = checked(
                c.get(xrpc + "com.atproto.repo.getRecord", params=params)
            ).json()
            record = current["value"]
            blob = checked(
                c.post(
                    xrpc + "com.atproto.repo.uploadBlob",
                    headers={**headers, "Content-Type": "image/jpeg"},
                    content=(ROOT / "avatars" / f"{name}.jpg").read_bytes(),
                )
            ).json()["blob"]
            labels = record.get("labels", {}).get("values", [])
            if not any(label.get("val") == "bot" for label in labels):
                labels.append({"val": "bot"})
            record.update(
                displayName=profile["name"],
                description=profile["bio"],
                avatar=blob,
                labels={"$type": "com.atproto.label.defs#selfLabels", "values": labels},
            )
            checked(
                c.post(
                    xrpc + "com.atproto.repo.putRecord",
                    headers=headers,
                    json={**params, "swapRecord": current["cid"], "record": record},
                )
            )
            avatar = f"https://cdn.bsky.app/img/avatar/plain/{entry['did']}/{blob['ref']['$link']}@jpeg"
            checked(
                c.put(
                    API + "/artists/me",
                    headers={"Authorization": "Bearer " + entry["plyr_token"]},
                    json={
                        "display_name": profile["name"],
                        "bio": profile["bio"],
                        "avatar_url": avatar,
                    },
                )
            )
            saved = checked(
                c.get(xrpc + "com.atproto.repo.getRecord", params=params)
            ).json()["value"]
            assert (
                saved["displayName"] == profile["name"]
                and {"val": "bot"} in saved["labels"]["values"]
            )
            print(name, profile["name"], "profile and bot label verified")


if __name__ == "__main__":
    main()
