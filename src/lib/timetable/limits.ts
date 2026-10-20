// Import limits (timetable.md "Import the uni timetable"), shared by the browser and the server.

/** Largest calendar file accepted. */
export const IMPORT_MAX_BYTES = 1024 * 1024;
/** Only the next 26 weeks are imported. */
export const IMPORT_HORIZON_WEEKS = 26;
/** Most classes (slots) one import may add. */
export const IMPORT_MAX_CLASSES = 500;
