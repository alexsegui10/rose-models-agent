import { describe, expect, it } from "vitest";
import { businessKnowledgeEntries } from "@/content/business";
import { CALL_AGENDA, callAgendaStage, nextCallAgendaStage, type CallAgendaStageId } from "@/application/callAgenda";

describe("agenda de la llamada", () => {
  it("tiene órdenes únicas y crecientes empezando en 1", () => {
    const orders = CALL_AGENDA.map((s) => s.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
    expect(Math.min(...orders)).toBe(1);
  });

  it("empieza en RAPPORT y termina en CLOSE", () => {
    const sorted = [...CALL_AGENDA].sort((a, b) => a.order - b.order);
    expect(sorted[0].id).toBe("RAPPORT");
    expect(sorted[sorted.length - 1].id).toBe("CLOSE");
  });

  it("toda referencia de conocimiento apunta a una entrada que existe (no hay drift)", () => {
    const ids = new Set(businessKnowledgeEntries.map((e) => e.id));
    for (const stage of CALL_AGENDA) {
      for (const ref of stage.knowledgeRefs) {
        expect(ids, `etapa ${stage.id} referencia '${ref}' inexistente`).toContain(ref);
      }
    }
  });

  it("nextCallAgendaStage recorre las etapas en orden y devuelve null al cubrirlas todas", () => {
    const covered: CallAgendaStageId[] = [];
    const visited: CallAgendaStageId[] = [];
    let next = nextCallAgendaStage(covered);
    while (next) {
      visited.push(next.id);
      covered.push(next.id);
      next = nextCallAgendaStage(covered);
    }
    expect(visited[0]).toBe("RAPPORT");
    expect(visited).toContain("MONEY");
    expect(visited[visited.length - 1]).toBe("CLOSE");
    expect(nextCallAgendaStage(covered)).toBeNull();
  });

  it("callAgendaStage lanza si el id no existe", () => {
    expect(() => callAgendaStage("NO_EXISTE" as CallAgendaStageId)).toThrow();
  });
});
