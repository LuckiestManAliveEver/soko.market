import { authenticationRoute } from "./routes";
import { getAuthenticationPromptTarget } from "./user-facing-error";

export interface AuthenticationActionMessageProps {
  message: string;
}

export function AuthenticationActionMessage({ message }: AuthenticationActionMessageProps) {
  const target = getAuthenticationPromptTarget(message);

  if (target === null) {
    return <>{message}</>;
  }

  return (
    <a
      className="authentication-required-link"
      data-testid={`authentication-${target}-link`}
      href={authenticationRoute(target)}
    >
      {message}
    </a>
  );
}
