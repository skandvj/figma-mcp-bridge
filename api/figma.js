const FIGMA_API_BASE = "https://api.figma.com/v1";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const { action, token, fileKey, nodeId, format = "svg" } = body;

  if (!token || !fileKey) {
    return res.status(400).json({
      error: "A Figma personal access token and file key are required."
    });
  }

  try {
    if (action === "inspect") {
      const [file, publishedComponents] = await Promise.all([
        figmaFetch(`/files/${encodeURIComponent(fileKey)}?depth=2`, token),
        figmaFetch(`/files/${encodeURIComponent(fileKey)}/components`, token).catch(() => null)
      ]);

      return res.status(200).json({
        fileName: file.name,
        lastModified: file.lastModified,
        version: file.version,
        pages: extractPages(file.document),
        components: mergeComponents(file.components || {}, publishedComponents?.meta?.components || [])
      });
    }

    if (action === "tokens") {
      const variables = await figmaFetch(`/files/${encodeURIComponent(fileKey)}/variables/local`, token);
      return res.status(200).json({
        tokens: normalizeVariables(variables?.meta?.variables || {}, variables?.meta?.variableCollections || {})
      });
    }

    if (action === "component") {
      if (!nodeId) {
        return res.status(400).json({ error: "nodeId is required for component inspection." });
      }
      const nodeResponse = await figmaFetch(
        `/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`,
        token
      );
      const node = nodeResponse.nodes?.[nodeId]?.document;
      return res.status(200).json({ component: normalizeNode(nodeId, node) });
    }

    if (action === "export") {
      if (!nodeId) {
        return res.status(400).json({ error: "nodeId is required for asset export." });
      }
      const imageResponse = await figmaFetch(
        `/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(nodeId)}&format=${encodeURIComponent(format)}`,
        token
      );
      return res.status(200).json({ url: imageResponse.images?.[nodeId] || null });
    }

    return res.status(400).json({ error: `Unsupported Figma action: ${action || "missing"}` });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}

async function figmaFetch(path, token) {
  const response = await fetch(`${FIGMA_API_BASE}${path}`, {
    headers: {
      "X-Figma-Token": token,
      Accept: "application/json"
    }
  });
  const text = await response.text();
  const payload = text ? safeJson(text) : {};

  if (!response.ok) {
    const detail = payload?.err || payload?.error || text.slice(0, 320);
    throw new Error(`Figma API ${response.status}: ${detail}`);
  }

  return payload;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractPages(documentNode) {
  return (documentNode?.children || []).map((page) => ({
    id: page.id,
    name: page.name,
    type: page.type,
    childCount: page.children?.length || 0
  }));
}

function mergeComponents(localComponents, publishedComponents) {
  const byNodeId = new Map();

  Object.entries(localComponents).forEach(([nodeId, component]) => {
    byNodeId.set(nodeId, {
      id: nodeId,
      key: component.key || null,
      name: component.name || nodeId,
      description: component.description || "",
      componentSetId: component.componentSetId || null,
      thumbnailUrl: component.thumbnail_url || component.thumbnailUrl || null
    });
  });

  publishedComponents.forEach((component) => {
    const nodeId = component.node_id || component.nodeId;
    if (!nodeId) return;
    byNodeId.set(nodeId, {
      id: nodeId,
      key: component.key || null,
      name: component.name || nodeId,
      description: component.description || "",
      componentSetId: component.component_set_id || component.componentSetId || null,
      thumbnailUrl: component.thumbnail_url || component.thumbnailUrl || null
    });
  });

  return [...byNodeId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeVariables(variables, collections) {
  return Object.values(variables).map((variable) => {
    const collection = collections[variable.variableCollectionId];
    const modeName = collection?.modes?.[0]?.name || "Default";
    const modeId = collection?.modes?.[0]?.modeId || Object.keys(variable.valuesByMode || {})[0];
    const value = variable.valuesByMode?.[modeId] ?? Object.values(variable.valuesByMode || {})[0];
    const cssValue = toCssValue(value, variable.resolvedType);

    return {
      id: variable.id,
      name: variable.name,
      type: variable.resolvedType,
      collection: collection?.name || "Local variables",
      mode: modeName,
      cssName: toCssVariable(variable.name),
      cssValue,
      description: variable.description || ""
    };
  });
}

function normalizeNode(nodeId, node) {
  if (!node) {
    return { id: nodeId, missing: true };
  }

  return {
    id: nodeId,
    name: node.name,
    type: node.type,
    description: node.description || "",
    layoutMode: node.layoutMode || null,
    primaryAxisSizingMode: node.primaryAxisSizingMode || null,
    counterAxisSizingMode: node.counterAxisSizingMode || null,
    itemSpacing: node.itemSpacing ?? null,
    padding: {
      top: node.paddingTop ?? null,
      right: node.paddingRight ?? null,
      bottom: node.paddingBottom ?? null,
      left: node.paddingLeft ?? null
    },
    size: {
      width: node.absoluteBoundingBox?.width ?? null,
      height: node.absoluteBoundingBox?.height ?? null
    },
    variants: Object.keys(node.componentPropertyDefinitions || {}),
    props: Object.entries(node.componentPropertyDefinitions || {}).map(([name, definition]) => ({
      name,
      type: definition.type,
      defaultValue: definition.defaultValue ?? null,
      variantOptions: definition.variantOptions || []
    }))
  };
}

function toCssVariable(name) {
  return `--figma-${String(name)
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()}`;
}

function toCssValue(value, type) {
  if (type === "COLOR" && value && typeof value === "object") {
    const red = Math.round((value.r || 0) * 255);
    const green = Math.round((value.g || 0) * 255);
    const blue = Math.round((value.b || 0) * 255);
    const alpha = value.a ?? 1;
    return alpha < 1 ? `rgba(${red}, ${green}, ${blue}, ${round(alpha)})` : rgbToHex(red, green, blue);
  }

  if (type === "FLOAT" && typeof value === "number") {
    return `${round(value)}px`;
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
