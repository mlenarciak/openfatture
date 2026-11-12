export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}
export class VersionConflict extends HttpError {
  constructor() { super(409, 'VERSION_CONFLICT', 'Data changed during this request. Refresh and try again.'); }
}
