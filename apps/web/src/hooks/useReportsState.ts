import { useState } from "react";

import { getErrorMessage } from "../chat-message-plumbing";
import { getJson } from "../api-helpers";
import type { BusinessKnowledgeSummary, BusinessReportSummary } from "../soko-application-shared";

interface UseReportsStateDeps {
  setStatusMessage: (message: string) => void;
  registerReset: (domainKey: string, fn: () => void) => void;
  registerRefresh: (
    domainKey: string,
    views: readonly string[],
    fn: (businessId: string) => Promise<void>
  ) => void;
}

export function useReportsState(deps: UseReportsStateDeps) {
  const [reportSummary, setReportSummary] = useState<BusinessReportSummary | null>(null);
  const [knowledgeSummary, setKnowledgeSummary] = useState<BusinessKnowledgeSummary | null>(null);

  async function loadReports(businessId: string) {
    try {
      const [report, knowledge] = await Promise.all([
        getJson<BusinessReportSummary>(
          `/businesses/${businessId}/reports/summary`,
          setReportSummary
        ),
        getJson<BusinessKnowledgeSummary>(
          `/businesses/${businessId}/knowledge`,
          setKnowledgeSummary
        )
      ]);
      setReportSummary(report);
      setKnowledgeSummary(knowledge);
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  deps.registerReset("reports", () => {
    setReportSummary(null);
    setKnowledgeSummary(null);
  });
  deps.registerRefresh("reports", ["home", "reports"], loadReports);

  return { reportSummary, knowledgeSummary, loadReports };
}
