import { agencyProfileEntries } from "./agency-profile";
import { callPolicyEntries } from "./call-policy";
import { candidateRequirementEntries } from "./candidate-requirements";
import { commercialPolicyEntries } from "./commercial-policy";
import { contentResponsibilityEntries } from "./content-responsibilities";
import { contractPolicyEntries } from "./contract-policy";
import { escalationPolicyEntries } from "./escalation-policy";
import { frequentlyAskedQuestionEntries } from "./frequently-asked-questions";
import { followUpPolicyEntries } from "./follow-up-policy";
import { objectionHandlingEntries } from "./objection-handling";
import { servicesPolicyEntries } from "./services-policy";
import { faceRequirementPolicyEntries } from "./face-requirement-policy";
import { geoPrivacyPolicyEntries } from "./geo-privacy-policy";
import { launchTimelineEntries } from "./launch-timeline";
import { multiAgencyPolicyEntries } from "./multi-agency-policy";
import { secondaryTrafficPolicyEntries } from "./secondary-traffic-policy";
import { selectionProcessFaqEntries } from "./selection-process-faq";

export { activeRevenueSharePolicy } from "./commercial-policy";
export { communicationPolicy, contentProductionPolicy } from "./content-responsibilities";
export { followUpPolicy } from "./follow-up-policy";

export const businessKnowledgeEntries = [
  ...agencyProfileEntries,
  ...callPolicyEntries,
  ...candidateRequirementEntries,
  ...commercialPolicyEntries,
  ...contentResponsibilityEntries,
  ...contractPolicyEntries,
  ...escalationPolicyEntries,
  ...frequentlyAskedQuestionEntries,
  ...followUpPolicyEntries,
  ...objectionHandlingEntries,
  ...servicesPolicyEntries,
  ...faceRequirementPolicyEntries,
  ...geoPrivacyPolicyEntries,
  ...launchTimelineEntries,
  ...multiAgencyPolicyEntries,
  ...secondaryTrafficPolicyEntries,
  ...selectionProcessFaqEntries
];
