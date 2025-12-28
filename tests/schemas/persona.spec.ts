import { describe, it, expect } from "vitest";
import { PersonaSchema, parsePersona, validatePersona } from "../../src/schemas/persona.js";

describe("PersonaSchema", () => {
  it("validates a minimal persona", () => {
    const minimalPersona = {
      name: "Example Persona",
      version: "1.0.0",
      triggers: ["example mode"],
      role: {
        title: "Example Role",
        scope: "Example scope",
      },
      duties: {
        must_do: ["Do something"],
        must_not_do: ["Never do something else"],
      },
    };

    const result = parsePersona(minimalPersona);
    expect(result.name).toBe("Example Persona");
    expect(result.version).toBe("1.0.0");
    expect(result.triggers).toEqual(["example mode"]);
  });

  it("applies default version if not provided", () => {
    const personaWithoutVersion = {
      name: "Example",
      triggers: ["example"],
      role: {
        title: "Example",
        scope: "Example",
      },
      duties: {
        must_do: ["Do"],
        must_not_do: ["Don't"],
      },
    };

    const result = parsePersona(personaWithoutVersion);
    expect(result.version).toBe("1.0.0");
  });

  it("validates persona with optional fields", () => {
    const fullPersona = {
      name: "Full Persona",
      version: "1.0.0",
      triggers: ["full mode", "activate full"],
      role: {
        title: "Full Role",
        scope: "Complete scope",
        repo: "/path/to/repo",
      },
      ritual: "FULL-PERSONA READY",
      duties: {
        must_do: ["Complete tasks", "Follow patterns"],
        must_not_do: ["Skip steps", "Break rules"],
      },
      gates: ["lint", "typecheck", "test"],
    };

    const result = parsePersona(fullPersona);
    expect(result.ritual).toBe("FULL-PERSONA READY");
    expect(result.role.repo).toBe("/path/to/repo");
    expect(result.gates).toEqual(["lint", "typecheck", "test"]);
  });

  it("rejects persona with missing required fields", () => {
    const invalidPersona = {
      name: "Invalid",
      triggers: ["invalid"],
      // Missing role and duties
    };

    expect(() => parsePersona(invalidPersona)).toThrow();
  });

  it("rejects persona with empty triggers array", () => {
    const invalidPersona = {
      name: "Invalid",
      triggers: [], // Empty array not allowed
      role: {
        title: "Role",
        scope: "Scope",
      },
      duties: {
        must_do: ["Do"],
        must_not_do: ["Don't"],
      },
    };

    expect(() => parsePersona(invalidPersona)).toThrow();
  });

  it("validates persona using validatePersona (safe parse)", () => {
    const validPersona = {
      name: "Safe Parse Test",
      triggers: ["test"],
      role: {
        title: "Tester",
        scope: "Testing",
      },
      duties: {
        must_do: ["Test"],
        must_not_do: ["Break"],
      },
    };

    const result = validatePersona(validPersona);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Safe Parse Test");
    }
  });

  it("returns error details for invalid persona using validatePersona", () => {
    const invalidPersona = {
      name: "Invalid",
      // Missing required fields
    };

    const result = validatePersona(invalidPersona);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toHaveProperty("path");
      expect(result.errors[0]).toHaveProperty("message");
      expect(result.errors[0]).toHaveProperty("code");
    }
  });

  it("validates duties structure", () => {
    const persona = {
      name: "Duties Test",
      triggers: ["duties"],
      role: {
        title: "Role",
        scope: "Scope",
      },
      duties: {
        must_do: ["Action 1", "Action 2", "Action 3"],
        must_not_do: ["Forbidden 1", "Forbidden 2"],
      },
    };

    const result = parsePersona(persona);
    expect(result.duties.must_do).toHaveLength(3);
    expect(result.duties.must_not_do).toHaveLength(2);
    expect(result.duties.must_do[0]).toBe("Action 1");
  });

  it("validates role structure", () => {
    const persona = {
      name: "Role Test",
      triggers: ["role"],
      role: {
        title: "Senior Engineer",
        scope: "Write code and design systems",
        repo: "/srv/lex-mcp/lexrunner",
      },
      duties: {
        must_do: ["Code"],
        must_not_do: ["Break"],
      },
    };

    const result = parsePersona(persona);
    expect(result.role.title).toBe("Senior Engineer");
    expect(result.role.scope).toBe("Write code and design systems");
    expect(result.role.repo).toBe("/srv/lex-mcp/lexrunner");
  });
});
