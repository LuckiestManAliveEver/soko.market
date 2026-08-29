import {
  validatePortableAgentManifest,
  type AgentImporter,
  type AgentImportInspection,
  type AgentImportSource,
  type PortableAgentManifest
} from "@soko/shared-types";

export class SokoManifestAgentImporter implements AgentImporter {
  supports(source: AgentImportSource): boolean {
    return source.kind === "soko-manifest";
  }

  async inspect(source: AgentImportSource): Promise<AgentImportInspection> {
    if (!this.supports(source) || source.kind !== "soko-manifest") {
      return { supported: false, valid: false, agentId: null, name: null, issues: [] };
    }
    const validation = validatePortableAgentManifest(source.manifest);
    return validation.valid
      ? {
          supported: true,
          valid: true,
          agentId: validation.manifest.agent.id,
          name: validation.manifest.agent.name,
          issues: []
        }
      : {
          supported: true,
          valid: false,
          agentId: null,
          name: null,
          issues: validation.issues
        };
  }

  async convert(source: AgentImportSource): Promise<PortableAgentManifest> {
    if (!this.supports(source) || source.kind !== "soko-manifest") {
      throw new Error("This importer only accepts a Soko agent manifest.");
    }
    const validation = validatePortableAgentManifest(source.manifest);
    if (!validation.valid) {
      throw new Error(
        `Invalid Soko agent manifest: ${validation.issues
          .map((issue) => `${issue.path} ${issue.message}`)
          .join("; ")}`
      );
    }
    return validation.manifest;
  }
}
