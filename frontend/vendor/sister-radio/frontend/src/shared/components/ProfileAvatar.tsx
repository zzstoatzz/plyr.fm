import { Show } from 'solid-js'
import type { AtprotoProfile } from '../lib/atproto'

export function ProfileAvatar(props: { profile: AtprotoProfile; class?: string; title?: string }) {
  return (
    <span class={`profile-avatar${props.class ? ` ${props.class}` : ''}`} title={props.title}>
      <Show when={props.profile.avatar} fallback={props.profile.handle.slice(0, 1).toUpperCase()}>
        {(avatar) => <img src={avatar()} alt="" />}
      </Show>
    </span>
  )
}
