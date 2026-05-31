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

  constructor(message: string) {
    super(message);
  }
}
