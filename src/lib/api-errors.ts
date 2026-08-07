export class ApiAuthError extends Error {
  status = 401;

  constructor(message: string) {
    super(message);
  }
}

export class ApiRateLimitError extends Error {
  status = 429;

  constructor(message: string) {
    super(message);
  }
}

export class ApiTimeoutError extends Error {
  status = 504;
  code?: string;
  jobId?: string;

  constructor(message: string, options: { code?: string; jobId?: string } = {}) {
    super(message);
    this.code = options.code;
    this.jobId = options.jobId;
  }
}
