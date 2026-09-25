// @ts-check
/**
 * Talks to the admin server. Every call carries the per-run token the server put in the page.
 * @typedef {import("../lib/types.ts").AdminState} AdminState
 * @typedef {import("../lib/types.ts").UploadResult} UploadResult
 * @typedef {import("../lib/types.ts").ApiError} ApiError
 */

const token = document.querySelector('meta[name="admin-token"]')?.getAttribute("content") ?? "";
const TOKEN_HEADER = "X-Admin-Token";

export class ApiRequestError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

/** @param {number} id */
export const thumbUrl = (id) => `/api/thumb/${id}?t=${encodeURIComponent(token)}`;

/** @param {number} status @param {string} text */
function errorFrom(status, text) {
  try {
    const body = /** @type {ApiError} */ (JSON.parse(text));
    if (body.message) return new ApiRequestError(body.message, status);
  } catch {
    // not JSON: fall through to a generic message
  }
  return new ApiRequestError(`The admin server answered with an error (${status}).`, status);
}

/**
 * @template T
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<T>}
 */
async function call(path, init = {}) {
  let response;
  try {
    response = await fetch(path, { ...init, headers: { ...init.headers, [TOKEN_HEADER]: token } });
  } catch {
    throw new ApiRequestError("Can't reach the admin server. Is `npm run admin` still running?", 0);
  }
  const text = await response.text();
  if (!response.ok) throw errorFrom(response.status, text);
  return JSON.parse(text);
}

/** @returns {Promise<AdminState>} */
export const getState = () => call("/api/state");

/**
 * @param {"reorder" | "move" | "delete" | "restore"} action
 * @param {object} body
 * @returns {Promise<AdminState>}
 */
export const post = (action, body) =>
  call(`/api/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * Upload one photo with progress (fetch can't report upload progress, XHR can).
 * @param {File} file
 * @param {string} project
 * @param {(fraction: number) => void} onProgress
 * @returns {Promise<UploadResult>}
 */
export function uploadPhoto(file, project, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("project", project);
    form.append("file", file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader(TOKEN_HEADER, token);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(errorFrom(xhr.status, xhr.responseText));
    });
    xhr.addEventListener("error", () =>
      reject(new ApiRequestError("The upload was interrupted. Is the admin still running?", 0)),
    );
    xhr.send(form);
  });
}
