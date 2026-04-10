import { describe, expect, it } from "vitest";

/**
 * Acceptance tests: GET /api/manifest returns correct operations for
 * hearts:save and hearts:list CLI commands.
 *
 * Design-doc requirements verified:
 * 1. Manifest contains hearts:save operation with POST method and /api/v1/user-picks path
 * 2. Manifest contains hearts:list operation with GET method and /api/v1/hearts path
 * 3. hearts:save has `url` as required body param
 * 4. hearts:list has `page` and `size` as optional query params
 */

import { GET } from "@/app/api/manifest/route";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ManifestParam {
  name: string;
  in: string;
  type: string;
  required: boolean;
  description: string;
  enum?: string[];
}

interface ManifestOperation {
  id: string;
  name: string;
  description: string;
  method: string;
  path: string;
  params: ManifestParam[];
}

interface ManifestResponse {
  version: string;
  base_url: string;
  auth: {
    type: string;
    authorize_url: string;
    service_id: string;
    cli_auth_path: string;
  };
  operations: ManifestOperation[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function fetchManifest(): Promise<ManifestResponse> {
  const response = await GET();
  expect(response.status).toBe(200);
  return (await response.json()) as ManifestResponse;
}

function findOperation(
  operations: ManifestOperation[],
  name: string,
): ManifestOperation | undefined {
  return operations.find((op) => op.name === name);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("GET /api/manifest – hearts operations (design-doc acceptance)", () => {
  /* ---- Manifest structure basics ---- */

  describe("manifest structure", () => {
    it("returns 200 with valid JSON", async () => {
      const response = await GET();
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toBeDefined();
    });

    it("manifest has operations array", async () => {
      const manifest = await fetchManifest();
      expect(Array.isArray(manifest.operations)).toBe(true);
      expect(manifest.operations.length).toBeGreaterThan(0);
    });

    it("manifest has version field", async () => {
      const manifest = await fetchManifest();
      expect(manifest).toHaveProperty("version");
    });

    it("manifest has auth configuration", async () => {
      const manifest = await fetchManifest();
      expect(manifest).toHaveProperty("auth");
      expect(manifest.auth).toHaveProperty("type");
    });
  });

  /* ---- Requirement 1: hearts:save operation exists ---- */

  describe("Requirement 1: hearts:save operation", () => {
    it("operations array contains hearts:save entry", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      expect(heartsSave).toBeDefined();
    });

    it("hearts:save uses POST method", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      expect(heartsSave?.method).toBe("POST");
    });

    it("hearts:save path is /api/v1/user-picks", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      expect(heartsSave?.path).toBe("/api/v1/user-picks");
    });

    it("hearts:save has a description", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      expect(heartsSave?.description).toBeTruthy();
      expect(heartsSave?.description.length).toBeGreaterThan(0);
    });

    it("hearts:save has a unique operation id", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      expect(heartsSave?.id).toBeTruthy();

      // Ensure no other operation shares this id
      const sameIdOps = manifest.operations.filter(
        (op) => op.id === heartsSave!.id,
      );
      expect(sameIdOps.length).toBe(1);
    });
  });

  /* ---- Requirement 2: hearts:list operation exists ---- */

  describe("Requirement 2: hearts:list operation", () => {
    it("operations array contains hearts:list entry", async () => {
      const manifest = await fetchManifest();
      const heartsList = findOperation(manifest.operations, "hearts:list");
      expect(heartsList).toBeDefined();
    });

    it("hearts:list uses GET method", async () => {
      const manifest = await fetchManifest();
      const heartsList = findOperation(manifest.operations, "hearts:list");
      expect(heartsList?.method).toBe("GET");
    });

    it("hearts:list path is /api/v1/hearts", async () => {
      const manifest = await fetchManifest();
      const heartsList = findOperation(manifest.operations, "hearts:list");
      expect(heartsList?.path).toBe("/api/v1/hearts");
    });

    it("hearts:list has a description", async () => {
      const manifest = await fetchManifest();
      const heartsList = findOperation(manifest.operations, "hearts:list");
      expect(heartsList?.description).toBeTruthy();
      expect(heartsList?.description.length).toBeGreaterThan(0);
    });

    it("hearts:list has a unique operation id", async () => {
      const manifest = await fetchManifest();
      const heartsList = findOperation(manifest.operations, "hearts:list");
      expect(heartsList?.id).toBeTruthy();

      const sameIdOps = manifest.operations.filter(
        (op) => op.id === heartsList!.id,
      );
      expect(sameIdOps.length).toBe(1);
    });
  });

  /* ---- Requirement 3: hearts:save has required `url` body param ---- */

  describe("Requirement 3: hearts:save `url` parameter", () => {
    it("hearts:save has params array", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      expect(Array.isArray(heartsSave?.params)).toBe(true);
    });

    it("hearts:save params include a `url` parameter", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      const urlParam = heartsSave?.params.find((p) => p.name === "url");
      expect(urlParam).toBeDefined();
    });

    it("`url` param for hearts:save is required", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      const urlParam = heartsSave?.params.find((p) => p.name === "url");
      expect(urlParam?.required).toBe(true);
    });

    it("`url` param for hearts:save is a body parameter", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      const urlParam = heartsSave?.params.find((p) => p.name === "url");
      expect(urlParam?.in).toBe("body");
    });

    it("`url` param for hearts:save has string type", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      const urlParam = heartsSave?.params.find((p) => p.name === "url");
      expect(urlParam?.type).toBe("string");
    });

    it("`url` param for hearts:save has a description", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      const urlParam = heartsSave?.params.find((p) => p.name === "url");
      expect(urlParam?.description).toBeTruthy();
    });
  });

  /* ---- Requirement 4: hearts:list has optional `page` and `size` query params ---- */

  describe("Requirement 4: hearts:list `page` and `size` parameters", () => {
    it("hearts:list has params array", async () => {
      const manifest = await fetchManifest();
      const heartsList = findOperation(manifest.operations, "hearts:list");
      expect(Array.isArray(heartsList?.params)).toBe(true);
    });

    it("hearts:list params include a `page` parameter", async () => {
      const manifest = await fetchManifest();
      const heartsList = findOperation(manifest.operations, "hearts:list");
      const pageParam = heartsList?.params.find((p) => p.name === "page");
      expect(pageParam).toBeDefined();
    });

    it("`page` param for hearts:list is optional (not required)", async () => {
      const manifest = await fetchManifest();
      const heartsList = findOperation(manifest.operations, "hearts:list");
      const pageParam = heartsList?.params.find((p) => p.name === "page");
      expect(pageParam?.required).toBeFalsy();
    });

    it("`page` param for hearts:list is a query parameter", async () => {
      const manifest = await fetchManifest();
      const heartsList = findOperation(manifest.operations, "hearts:list");
      const pageParam = heartsList?.params.find((p) => p.name === "page");
      expect(pageParam?.in).toBe("query");
    });

    it("hearts:list params include a `size` parameter", async () => {
      const manifest = await fetchManifest();
      const heartsList = findOperation(manifest.operations, "hearts:list");
      const sizeParam = heartsList?.params.find((p) => p.name === "size");
      expect(sizeParam).toBeDefined();
    });

    it("`size` param for hearts:list is optional (not required)", async () => {
      const manifest = await fetchManifest();
      const heartsList = findOperation(manifest.operations, "hearts:list");
      const sizeParam = heartsList?.params.find((p) => p.name === "size");
      expect(sizeParam?.required).toBeFalsy();
    });

    it("`size` param for hearts:list is a query parameter", async () => {
      const manifest = await fetchManifest();
      const heartsList = findOperation(manifest.operations, "hearts:list");
      const sizeParam = heartsList?.params.find((p) => p.name === "size");
      expect(sizeParam?.in).toBe("query");
    });

    it("`page` and `size` both have descriptions", async () => {
      const manifest = await fetchManifest();
      const heartsList = findOperation(manifest.operations, "hearts:list");
      const pageParam = heartsList?.params.find((p) => p.name === "page");
      const sizeParam = heartsList?.params.find((p) => p.name === "size");
      expect(pageParam?.description).toBeTruthy();
      expect(sizeParam?.description).toBeTruthy();
    });
  });

  /* ---- Cross-cutting: hearts:save and hearts:list are distinct ops ---- */

  describe("hearts:save and hearts:list are distinct operations", () => {
    it("hearts:save and hearts:list have different operation ids", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      const heartsList = findOperation(manifest.operations, "hearts:list");
      expect(heartsSave?.id).not.toBe(heartsList?.id);
    });

    it("hearts:save and hearts:list have different HTTP methods", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      const heartsList = findOperation(manifest.operations, "hearts:list");
      expect(heartsSave?.method).not.toBe(heartsList?.method);
    });

    it("hearts:save and hearts:list have different paths", async () => {
      const manifest = await fetchManifest();
      const heartsSave = findOperation(manifest.operations, "hearts:save");
      const heartsList = findOperation(manifest.operations, "hearts:list");
      expect(heartsSave?.path).not.toBe(heartsList?.path);
    });
  });
});
