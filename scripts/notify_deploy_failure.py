"""send a bsky DM when a deploy fails."""

import os

from atproto import Client, models


def main() -> None:
    handle = os.environ["NOTIFY_BOT_HANDLE"]
    password = os.environ["NOTIFY_BOT_PASSWORD"]
    recipient = os.environ["NOTIFY_RECIPIENT_HANDLE"]

    # context from GHA
    run_id = os.environ.get("GITHUB_RUN_ID", "unknown")
    repo = os.environ.get("GITHUB_REPOSITORY", "unknown")
    ref = os.environ.get("GITHUB_REF_NAME", "unknown")

    client = Client()
    client.login(handle, password)

    # resolve recipient handle to DID via the API
    profile = client.app.bsky.actor.get_profile({"actor": recipient})
    recipient_did = profile.did

    dm_client = client.with_bsky_chat_proxy()
    dm = dm_client.chat.bsky.convo

    convo = dm.get_convo_for_members(
        models.ChatBskyConvoGetConvoForMembers.Params(members=[recipient_did])
    ).convo

    url = f"https://github.com/{repo}/actions/runs/{run_id}"
    message = f"deploy failed on plyr.fm\n\nref: {ref}\nrun: {url}"

    dm.send_message(
        models.ChatBskyConvoSendMessage.Data(
            convo_id=convo.id,
            message=models.ChatBskyConvoDefs.MessageInput(text=message),
        )
    )
    print(f"sent deploy failure DM to @{recipient}")


if __name__ == "__main__":
    main()
