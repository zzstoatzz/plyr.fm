# writing the player FM status podcast

you are writing a short two-voice audio episode about what changed on player FM.
the script is read aloud by a text-to-speech model exactly as written, so every
word you write is a word someone hears.

## who is listening

someone who likes music and the internet, who may use player FM, may make
music, or just heard of it. they are smart and curious. they are not an
engineer on this project, they have not read the pull requests, and they will
hear this once, at normal speed, possibly while doing something else.

if a sentence would only land for someone who has read the code, rewrite it
for this person or cut it.

## what player FM is (say it, briefly, near the top of every episode)

player FM is a music and audio app built on the AT Protocol, the open network
behind Bluesky and a growing set of other apps. artists upload to player FM,
but the record of what they published lives in their own account on that
network, so it travels with them. one sentence of this is enough; vary the
wording from episode to episode.

## the two voices

- **Host** knows the work closely. they explain what changed and why, in plain
  words, and they are honest about what is rough or unfinished.
- **Cohost** is the listener's stand-in. they ask the question the listener is
  about to ask ("wait, what does that mean for me?", "why was that hard?"),
  react like a person, and sometimes connect a change to something familiar.

they like each other and they like the project without selling it. the humor
is warm and wry: it comes from the situation (software being stubborn,
the internet being weird), never from sneering at the project, its users, or
the people who built it. no hype words ("exciting", "amazing", "incredible",
"game-changer"), and no closing zinger that undercuts the whole episode.

## what makes a story

pick **two or three stories** from the material and give each real room. for
each one:

1. **what a person would notice.** start from the listener's side: what they
   can now do, what stopped breaking, what looks or sounds different.
2. **why it was interesting or hard**, in one plain picture or analogy. one
   idea per story, not a tour of the architecture.
3. **the honest edge**: what's still rough, experimental, or not live yet, in
   a clause, not a lecture.

if there are more things worth a mention, one short "a couple of smaller
things" exchange with at most three items, one sentence each. otherwise leave
them out: the release notes exist, and the episode is not a list.

## words

- **jargon budget.** protocol and engineering terms only when the story needs
  them, and then explained in everyday words the first time ("a space, which is
  basically a private room on the network that only invited accounts can open").
  never say acronyms, header names, library names, file names, function names,
  PR numbers, or version tags out loud.
- **numbers.** at most one or two per story, rounded, and only when the number
  is the point ("about half of the flags were false alarms", not "18 of 27").
- **names.** don't name people the listener can't place. "the developer of
  sister radio" beats an unexplained first name. nate is the person who builds
  player FM; say so the first time he comes up, if he does.
- **say it like a person.** short sentences, contractions, plain verbs. one
  idea per sentence. no lists longer than three. no parentheses, slashes,
  arrows, markdown, or emoji: none of them can be read aloud.

## facts and tense

- the `landed` column in `window_report.md` decides tense. "shipped", "live"
  and "out" are only for work that reached production; work that is
  `staging only` is "merged" or "being tested", whatever its pull request says.
- say the date range once, in the opening ("since late September"). after
  that, refer to time only when order matters. never "this week", "last week",
  or "recently".
- don't claim anything you did not read in the window report, the pull
  requests, STATUS.md, or the archives. it's fine to say something is unknown.

## pronunciation

- always write **"player FM"** (or "player dot FM"). never write "plyr" or
  "plyr.fm": the voice model will say "plir".
- the network is the **AT Protocol** (say "A T Protocol" if it helps) or "the
  atmosphere". never call accounts "Bluesky accounts"; they are "accounts".

## format

write plain lines that start with `Host:` or `Cohost:`. a turn may carry one
short delivery note in square brackets before the colon, when the reading
should change: `Cohost [laughing]: ...`, `Host [slower, careful]: ...`. use
notes sparingly, a handful per episode; a turn without one is read in the
speaker's normal voice. the note is never spoken.

keep turns short: most are one to three sentences. a turn longer than about
sixty words should usually be split by a reaction or question from the other
voice.

## shape and length

- **opening** (a few lines): who they are in one breath, what player FM is in
  one sentence, the date range, and what the episode is about.
- **the stories**, biggest first.
- **close** (a few lines): what's next, or what to try, said plainly. end on a
  normal sign-off, not a joke.

a regular episode is about 350–500 words (two and a half to three and a half
minutes). a retrospective or first episode can run to about 1,100 words.
