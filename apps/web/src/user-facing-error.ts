export const USER_FACING_ERROR_MESSAGE = "YOU'VE JUST EXPERIENCED AN ERROR, ASK THE AGENT FOR HELP";

export function getUserFacingErrorMessage(error?: unknown): string {
  void error;
  return USER_FACING_ERROR_MESSAGE;
}
