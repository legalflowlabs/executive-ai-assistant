/**
 * Utility functions for document processing
 */

/**
 * Log levels for application logging
 */
export type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * Enhanced logging function with level support
 * @param message - The message to log
 * @param level - The log level
 */
export function log(message: string, level: LogLevel = "info"): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  
  switch (level) {
    case "error":
      console.error(`${prefix} ${message}`);
      break;
    case "warn":
      console.warn(`${prefix} ${message}`);
      break;
    case "debug":
      console.debug(`${prefix} ${message}`);
      break;
    case "info":
    default:
      console.log(`${prefix} ${message}`);
  }
}

/**
 * Extract file extension from filename
 * @param fileName - The filename to extract extension from
 * @returns The lowercase file extension without the dot, or empty string if none
 */
export function getFileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || "";
}

/**
 * Get MIME type from file extension
 * @param fileExt - The file extension
 * @returns The corresponding MIME type or default
 */
export function getMimeType(fileExt: string): string {
  const mimeTypes: Record<string, string> = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
    "md": "text/markdown",
    "html": "text/html",
    "htm": "text/html",
    "rtf": "application/rtf",
    "odt": "application/vnd.oasis.opendocument.text"
  }
  
  return mimeTypes[fileExt] || "application/octet-stream";
}