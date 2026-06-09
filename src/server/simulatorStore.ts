import { ConversationEngine } from "@/application/conversationEngine";
import { InMemoryImportedConversationRepository } from "@/application/conversationImport";
import { InMemoryEvaluationRepository } from "@/application/evaluationRunner";
import { createLlmProviders } from "@/application/llmFactory";
import { InMemoryConversationFeedbackRepository } from "@/application/responseFeedback";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

const globalForSimulator = globalThis as typeof globalThis & {
  roseSimulatorRepository?: InMemoryCandidateRepository;
  roseSimulatorEngine?: ConversationEngine;
  roseFeedbackRepository?: InMemoryConversationFeedbackRepository;
  roseEvaluationRepository?: InMemoryEvaluationRepository;
  roseImportedConversationRepository?: InMemoryImportedConversationRepository;
};

export function getSimulatorRepository(): InMemoryCandidateRepository {
  if (!globalForSimulator.roseSimulatorRepository) {
    globalForSimulator.roseSimulatorRepository = new InMemoryCandidateRepository();
  }

  return globalForSimulator.roseSimulatorRepository;
}

export function getSimulatorEngine(): ConversationEngine {
  if (!globalForSimulator.roseSimulatorEngine) {
    const providers = createLlmProviders();
    globalForSimulator.roseSimulatorEngine = new ConversationEngine({
      repository: getSimulatorRepository(),
      understandingProvider: providers.understandingProvider,
      draftingProvider: providers.draftingProvider,
      automationMode: providers.config.automationMode
    });
  }

  return globalForSimulator.roseSimulatorEngine;
}

export function getFeedbackRepository(): InMemoryConversationFeedbackRepository {
  if (!globalForSimulator.roseFeedbackRepository) {
    globalForSimulator.roseFeedbackRepository = new InMemoryConversationFeedbackRepository();
  }

  return globalForSimulator.roseFeedbackRepository;
}

export function getEvaluationRepository(): InMemoryEvaluationRepository {
  if (!globalForSimulator.roseEvaluationRepository) {
    globalForSimulator.roseEvaluationRepository = new InMemoryEvaluationRepository();
  }

  return globalForSimulator.roseEvaluationRepository;
}

export function getImportedConversationRepository(): InMemoryImportedConversationRepository {
  if (!globalForSimulator.roseImportedConversationRepository) {
    globalForSimulator.roseImportedConversationRepository = new InMemoryImportedConversationRepository();
  }

  return globalForSimulator.roseImportedConversationRepository;
}
