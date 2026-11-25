// Generated from next/backend/src/internal/media/audio_format.zig by
// `zig build gen-audio-format`. Do not edit: change the zig and regenerate.

export type AudioContainer = 'mp3' | 'adts' | 'mp4' | 'wav' | 'flac' | 'aiff' | 'ogg' | 'webm';
export type AudioCodec = 'mp3' | 'aac' | 'alac' | 'pcm' | 'flac' | 'vorbis' | 'opus' | 'other' | 'unknown';
export type AudioRule = 'as_is' | 'process' | 'by_codec';

export type AudioContainerInfo = {
  contentType: string; fileType: string; label: string;
  fileTypeAliases: readonly string[]; contentTypeAliases: readonly string[];
  rule: AudioRule; asIsCodecs: readonly AudioCodec[];
};

export const AUDIO_CONTAINERS: Readonly<Record<AudioContainer, AudioContainerInfo>> = {
  mp3: { contentType: 'audio/mpeg', fileType: 'mp3', label: 'MP3', fileTypeAliases: ['mpeg', 'mpga'], contentTypeAliases: ['audio/mp3', 'audio/x-mpeg', 'audio/mpeg3', 'audio/x-mp3'], rule: 'as_is', asIsCodecs: [] },
  adts: { contentType: 'audio/aac', fileType: 'aac', label: 'AAC', fileTypeAliases: [], contentTypeAliases: ['audio/x-aac', 'audio/aacp'], rule: 'as_is', asIsCodecs: [] },
  mp4: { contentType: 'audio/mp4', fileType: 'm4a', label: 'M4A', fileTypeAliases: ['mp4', 'm4b', 'alac'], contentTypeAliases: ['audio/x-m4a', 'audio/m4a', 'video/mp4'], rule: 'by_codec', asIsCodecs: ['aac'] },
  wav: { contentType: 'audio/wav', fileType: 'wav', label: 'WAV', fileTypeAliases: ['wave'], contentTypeAliases: ['audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'audio/x-pn-wav'], rule: 'process', asIsCodecs: [] },
  flac: { contentType: 'audio/flac', fileType: 'flac', label: 'FLAC', fileTypeAliases: [], contentTypeAliases: ['audio/x-flac'], rule: 'process', asIsCodecs: [] },
  aiff: { contentType: 'audio/aiff', fileType: 'aiff', label: 'AIFF', fileTypeAliases: ['aif', 'aifc'], contentTypeAliases: ['audio/x-aiff'], rule: 'process', asIsCodecs: [] },
  ogg: { contentType: 'audio/ogg', fileType: 'ogg', label: 'Ogg', fileTypeAliases: ['oga', 'opus'], contentTypeAliases: ['audio/opus', 'audio/vorbis', 'audio/x-opus+ogg', 'application/ogg'], rule: 'process', asIsCodecs: [] },
  webm: { contentType: 'audio/webm', fileType: 'webm', label: 'WebM', fileTypeAliases: ['weba'], contentTypeAliases: ['video/webm'], rule: 'process', asIsCodecs: [] },
};

export const AUDIO_HEAD_BYTES = 65536;
