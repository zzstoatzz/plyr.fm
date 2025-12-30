# ambient state visualization

*captured 2024-12-30*

## the idea

YouTube ambiance videos (lo-fi girl, futuristic cityscapes, cozy cabins) create mood through static loops. What if the scene was a live representation of playback state?

Not an audio visualizer overlaid on content. The visualization *is* the world. Diegetic. You wouldn't realize you're looking at data until you notice the storm picks up when the drums hit.

## perturbation and sensitivity

The track perturbs the environment proportionally. A quiet acoustic piece barely ripples the scene. A dense electronic track creates weather.

Think lightning at its best: you have no idea where it might strike, it crackles in the most ephemeral and perfect ways. The visualization follows a basic protocol - it enhances without overwhelming, it responds without dominating. The effect should feel discovered, not imposed.

## mappings (gestures, not specifications)

| audio feature | scene element |
|---------------|---------------|
| energy/loudness | rain intensity, wind, particle density |
| tempo | motion speed of ambient elements (ships, clouds, traffic) |
| spectral brightness | lighting warmth, time of day |
| queue position | scene progression, journey through space |
| track transitions | weather shifts, scene cuts |

## why this matters

Current players treat audio as invisible. You press play and look elsewhere. This inverts that: the player becomes a place you inhabit. The music shapes the space you're in.

## technical direction (long-term)

- real-time audio feature extraction (web audio API, ML models for mood/genre)
- procedural/generative scenes (shaders, or orchestrated 3D environments)
- state mapping layer (audio features → scene parameters)
- user-configurable sensitivity (how much does music perturb your space?)

## open questions

- how do you represent multiple tracks in queue visually without it becoming a dashboard?
- does the scene have memory? does a heavy track leave residue?
- how do you handle silence? what's the resting state?
- can listeners share scenes? customize their own?
