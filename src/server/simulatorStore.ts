import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { ConversationEngine } from "@/application/conversationEngine";
import { InMemoryImportedConversationRepository } from "@/application/conversationImport";
import { InMemoryEvaluationRepository } from "@/application/evaluationRunner";
import { createLlmProviders } from "@/application/llmFactory";
import { InMemoryConversationFeedbackRepository } from "@/application/responseFeedback";
import {
  createDebouncedPersister,
  loadSnapshot,
  saveSnapshotAtomic,
  wrapWithPersistence
} from "@/infrastructure/persistence/jsonSnapshotStore";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

const SNAPSHOT_FILE_PATH = join(process.cwd(), "data", "simulator-snapshot.json");
const SNAPSHOT_DEBOUNCE_MS = 300;

interface SimulatorRepositories {
  candidateRepository: InMemoryCandidateRepository;
  feedbackRepository: InMemoryConversationFeedbackRepository;
  evaluationRepository: InMemoryEvaluationRepository;
  importedConversationRepository: InMemoryImportedConversationRepository;
}

const globalForSimulator = globalThis as typeof globalThis & {
  roseSimulatorRepository?: InMemoryCandidateRepository;
  roseSimulatorEngine?: ConversationEngine;
  roseFeedbackRepository?: InMemoryConversationFeedbackRepository;
  roseEvaluationRepository?: InMemoryEvaluationRepository;
  roseImportedConversationRepository?: InMemoryImportedConversationRepository;
  roseSnapshotExitHookRegistered?: boolean;
};

function ensureSimulatorRepositories(): SimulatorRepositories {
  if (
    globalForSimulator.roseSimulatorRepository &&
    globalForSimulator.roseFeedbackRepository &&
    globalForSimulator.roseEvaluationRepository &&
    globalForSimulator.roseImportedConversationRepository
  ) {
    return {
      candidateRepository: globalForSimulator.roseSimulatorRepository,
      feedbackRepository: globalForSimulator.roseFeedbackRepository,
      evaluationRepository: globalForSimulator.roseEvaluationRepository,
      importedConversationRepository: globalForSimulator.roseImportedConversationRepository
    };
  }

  // Si se recrean los repos (p. ej. hot-reload con globals parciales), el engine cacheado
  // quedaria apuntando a un repo descartado cuyas escrituras nadie veria ni persistiria.
  globalForSimulator.roseSimulatorEngine = undefined;

  const candidateRepository = new InMemoryCandidateRepository();
  const feedbackRepository = new InMemoryConversationFeedbackRepository();
  const evaluationRepository = new InMemoryEvaluationRepository();
  const importedConversationRepository = new InMemoryImportedConversationRepository();

  if (process.env.SIMULATOR_SNAPSHOT !== "off") {
    try {
      mkdirSync(dirname(SNAPSHOT_FILE_PATH), { recursive: true });
    } catch {
      console.warn("[simulatorStore] Could not create the data/ directory; snapshot persistence may fail.");
    }

    const snapshot = loadSnapshot(SNAPSHOT_FILE_PATH);
    if (snapshot) {
      candidateRepository.restoreSnapshot(snapshot.candidateRepository);
      feedbackRepository.restoreSnapshot(snapshot.feedbackRepository);
      evaluationRepository.restoreSnapshot(snapshot.evaluationRepository);
      importedConversationRepository.restoreSnapshot(snapshot.importedConversationRepository);
    }

    const persister = createDebouncedPersister(() => {
      saveSnapshotAtomic(SNAPSHOT_FILE_PATH, {
        version: 1,
        savedAt: new Date(),
        candidateRepository: candidateRepository.toSnapshot(),
        feedbackRepository: feedbackRepository.toSnapshot(),
        evaluationRepository: evaluationRepository.toSnapshot(),
        importedConversationRepository: importedConversationRepository.toSnapshot()
      });
    }, SNAPSHOT_DEBOUNCE_MS);

    // El evento "exit" corre codigo sincrono incluso tras process.exit(): cubre la ventana
    // de debounce (~300ms) en la que una mutacion aun no se ha volcado a disco.
    if (!globalForSimulator.roseSnapshotExitHookRegistered) {
      globalForSimulator.roseSnapshotExitHookRegistered = true;
      process.once("exit", () => persister.flush());
    }

    globalForSimulator.roseSimulatorRepository = wrapWithPersistence(candidateRepository, persister.schedule);
    globalForSimulator.roseFeedbackRepository = wrapWithPersistence(feedbackRepository, persister.schedule);
    globalForSimulator.roseEvaluationRepository = wrapWithPersistence(evaluationRepository, persister.schedule);
    globalForSimulator.roseImportedConversationRepository = wrapWithPersistence(
      importedConversationRepository,
      persister.schedule
    );
  } else {
    globalForSimulator.roseSimulatorRepository = candidateRepository;
    globalForSimulator.roseFeedbackRepository = feedbackRepository;
    globalForSimulator.roseEvaluationRepository = evaluationRepository;
    globalForSimulator.roseImportedConversationRepository = importedConversationRepository;
  }

  return {
    candidateRepository: globalForSimulator.roseSimulatorRepository,
    feedbackRepository: globalForSimulator.roseFeedbackRepository,
    evaluationRepository: globalForSimulator.roseEvaluationRepository,
    importedConversationRepository: globalForSimulator.roseImportedConversationRepository
  };
}

export function getSimulatorRepository(): InMemoryCandidateRepository {
  return ensureSimulatorRepositories().candidateRepository;
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
  return ensureSimulatorRepositories().feedbackRepository;
}

export function getEvaluationRepository(): InMemoryEvaluationRepository {
  return ensureSimulatorRepositories().evaluationRepository;
}

export function getImportedConversationRepository(): InMemoryImportedConversationRepository {
  return ensureSimulatorRepositories().importedConversationRepository;
}
