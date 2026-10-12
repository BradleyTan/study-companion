export const SUBJECT_COLOURS = {
  sky: "#8fb8ff",
  sun: "#ffe45c",
  coral: "#ff9a8b",
  mint: "#7be0b0",
  lilac: "#c9b6ff",
  peach: "#ffc48f",
  rose: "#ffb3d9",
  sage: "#b8d99a",
} as const;

export type SubjectColour = keyof typeof SUBJECT_COLOURS;
export const COLOUR_NAMES = Object.keys(SUBJECT_COLOURS) as SubjectColour[];

export const SUBJECT_EMOJIS = [
  "🧬", "📐", "⚖️", "🧪", "💻", "📊", "🌍", "📚",
  "🎨", "🎵", "🩺", "🧠", "🏛️", "💰", "⚙️", "🔭",
  "🗣️", "✍️", "🌱", "🧮", "📈", "🎭", "🏗️", "🐾",
] as const;
