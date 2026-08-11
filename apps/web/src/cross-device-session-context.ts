import type { SokoChatSurface, SokoMode } from "@soko/shared-types";
import type { ShellView } from "./app-shell";

export function surfaceForShellView(view: ShellView, mode: SokoMode): SokoChatSurface {
  if (mode === "marketplace") return "conversation";
  if (view === "chat") return "conversation";
  if (view === "products") return "catalogue";
  if (view === "invoices" || view === "payments" || view === "logistics") return "order";
  if (view === "imports") return "receipt";
  return "owner-controls";
}

export function shellViewForSurface(surface: SokoChatSurface, mode: SokoMode): ShellView {
  if (mode === "marketplace") return "chat";
  if (surface === "catalogue" || surface === "product") return "products";
  if (surface === "order") return "invoices";
  if (surface === "receipt") return "imports";
  if (surface === "owner-controls") return "home";
  return "chat";
}
