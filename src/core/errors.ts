export enum ErrorCode {
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  CONFIG_MISSING = 'CONFIG_MISSING',
  INVALID_PARAMS = 'INVALID_PARAMS',
  NOT_FOUND = 'NOT_FOUND',
  FORBIDDEN = 'FORBIDDEN',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  RATE_LIMITED = 'RATE_LIMITED',
  SERVER_ERROR = 'SERVER_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export enum ExitCode {
  SUCCESS = 0,
  GENERAL_ERROR = 1,
  INVALID_PARAMS = 2,
  AUTH_ERROR = 3,
  FORBIDDEN = 4,
  NOT_FOUND = 5,
  NETWORK_ERROR = 6,
}

export class AnycliError extends Error {
  code: ErrorCode;
  hint?: string;
  exitCode: ExitCode;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'AnycliError';
    this.code = code;
    this.hint = hint;
    this.exitCode = this.mapExitCode(code);
  }

  private mapExitCode(code: ErrorCode): ExitCode {
    switch (code) {
      case ErrorCode.AUTH_REQUIRED:
      case ErrorCode.AUTH_EXPIRED:
        return ExitCode.AUTH_ERROR;
      case ErrorCode.INVALID_PARAMS:
        return ExitCode.INVALID_PARAMS;
      case ErrorCode.FORBIDDEN:
        return ExitCode.FORBIDDEN;
      case ErrorCode.NOT_FOUND:
        return ExitCode.NOT_FOUND;
      case ErrorCode.NETWORK_ERROR:
      case ErrorCode.TIMEOUT:
        return ExitCode.NETWORK_ERROR;
      default:
        return ExitCode.GENERAL_ERROR;
    }
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        hint: this.hint,
      },
    };
  }
}
