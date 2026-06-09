import { agencyProfileEntries } from "./agency-profile";
import { callPolicyEntries } from "./call-policy";
import { candidateRequirementEntries } from "./candidate-requirements";
import { commercialPolicyEntries } from "./commercial-policy";
import { contentResponsibilityEntries } from "./content-responsibilities";
import { contractPolicyEntries } from "./contract-policy";
import { escalationPolicyEntries } from "./escalation-policy";
import { frequentlyAskedQuestionEntries } from "./frequently-asked-questions";
import { objectionHandlingEntries } from "./objection-handling";
import { servicesPolicyEntries } from "./services-policy";

export { activeRevenueSharePolicy } from "./commercial-policy";

export const businessKnowledgeEntries = [
  ...agencyProfileEntries,
  ...callPolicyEntries,
  ...candidateRequirementEntries,
  ...commercialPolicyEntries,
  ...contentResponsibilityEntries,
  ...contractPolicyEntries,
  ...escalationPolicyEntries,
  ...frequentlyAskedQuestionEntries,
  ...objectionHandlingEntries,
  ...servicesPolicyEntries
];

