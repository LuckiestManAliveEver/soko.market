const unexplainedErrorMessage =
  "Soko could not complete this request because the server did not provide an explanation. Please try again.";

const firebaseErrorMessages: Array<[pattern: RegExp, message: string]> = [
  [
    /auth\/invalid-phone-number/i,
    "That phone number is not valid. Include the country code, for example +254700000000."
  ],
  [
    /auth\/invalid-verification-code/i,
    "The SMS verification code is incorrect. Check the code and enter it again."
  ],
  [/auth\/code-expired/i, "The SMS verification code has expired. Request a new code."],
  [
    /auth\/too-many-requests/i,
    "Phone verification is temporarily blocked because too many attempts were made. Wait before trying again."
  ],
  [
    /auth\/network-request-failed/i,
    "Phone verification could not reach Firebase. Check your internet connection and try again."
  ],
  [
    /auth\/(?:invalid-app-credential|missing-app-credential)/i,
    "Phone verification could not start because this deployment's Firebase configuration is incomplete."
  ]
];

export function getUserFacingErrorMessage(
  error: unknown,
  fallback = unexplainedErrorMessage
): string {
  const message = readErrorMessage(error);

  if (message === null) {
    return fallback;
  }

  for (const [pattern, explanation] of firebaseErrorMessages) {
    if (pattern.test(message)) {
      return explanation;
    }
  }

  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return "Soko could not reach the server. Check your internet connection and try again.";
  }

  if (/aborterror|the operation was aborted|request was aborted/i.test(message)) {
    return "The request was cancelled before it finished. Try again when you are ready.";
  }

  return message;
}

export async function getResponseErrorMessage(response: Response): Promise<string> {
  const payload = await readResponsePayload(response);
  const explanation = readErrorMessage(payload);

  if (explanation !== null) {
    return explanation;
  }

  return getHttpStatusExplanation(response.status, response.statusText);
}

function readErrorMessage(error: unknown): string | null {
  if (typeof error === "string") {
    return nonEmpty(error);
  }

  if (error instanceof Error) {
    return nonEmpty(error.message);
  }

  if (typeof error !== "object" || error === null) {
    return null;
  }

  const record = error as Record<string, unknown>;
  for (const key of ["message", "detail", "error", "reason"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  if (Array.isArray(record.errors)) {
    const messages = record.errors
      .map((entry) => readErrorMessage(entry))
      .filter((entry): entry is string => entry !== null);
    if (messages.length > 0) {
      return messages.join(" ");
    }
  }

  return null;
}

async function readResponsePayload(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (text.trim() === "") {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

function getHttpStatusExplanation(status: number, statusText: string): string {
  const explanations: Record<number, string> = {
    400: "The server could not process the request because some submitted information is invalid.",
    401: "Your session is missing or has expired. Sign in and try again.",
    403: "Your account does not have permission to perform this action.",
    404: "The requested account, conversation, or record could not be found.",
    409: "The request conflicts with a newer change. Refresh the latest information and try again.",
    413: "The uploaded file is larger than the server allows.",
    415: "The uploaded file format is not supported.",
    422: "The submitted information could not be accepted. Review the fields and try again.",
    429: "Too many requests were made in a short time. Wait a moment before trying again.",
    500: "The server encountered an unexpected problem while processing the request.",
    502: "The server could not get a valid response from a required service.",
    503: "A required service is temporarily unavailable or has not been configured.",
    504: "A required service took too long to respond."
  };

  return (
    explanations[status] ??
    `The request could not be completed because the server returned HTTP ${status}${
      statusText.trim() === "" ? "" : ` (${statusText})`
    }.`
  );
}

function nonEmpty(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}
