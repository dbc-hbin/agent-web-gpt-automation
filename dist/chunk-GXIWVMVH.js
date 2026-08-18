// src/core/devspace/qualification.ts
import * as path from "node:path";
function rootsFrom(value) {
  if (!value || typeof value !== "object") return [];
  const obj = value;
  const roots = obj.allowedRoots ?? obj.allowed_roots ?? obj.result?.allowedRoots;
  return Array.isArray(roots) ? roots.filter((v) => typeof v === "string").map((v) => path.resolve(v)) : [];
}
async function qualifyExactProjectRoot(projectRoot, client) {
  const root = path.resolve(projectRoot);
  let opened;
  try {
    opened = await client.open_workspace({ root });
  } catch (error) {
    return { ok: false, code: "DEVSPACE_OPEN_WORKSPACE_FAILED", projectRoot: root, detail: String(error) };
  }
  const allowedRoots = rootsFrom(opened);
  if (allowedRoots.length !== 1 || allowedRoots[0] !== root) {
    return { ok: false, code: "DEVSPACE_EXACT_ROOT_MISMATCH", projectRoot: root, allowedRoots };
  }
  try {
    await client.list_directory({ path: root });
  } catch (error) {
    return { ok: false, code: "DEVSPACE_READONLY_TOOL_FAILED", projectRoot: root, allowedRoots, detail: String(error) };
  }
  return { ok: true, code: "DEVSPACE_EXACT_ROOT_QUALIFIED", projectRoot: root, allowedRoots };
}

export {
  qualifyExactProjectRoot
};
//# sourceMappingURL=chunk-GXIWVMVH.js.map