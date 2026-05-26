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
        figmaFetch(`/files/${encodeURIComponent(fileKey)}?depth=4`, token),
        figmaFetch(`/files/${encodeURIComponent(fileKey)}/components`, token).catch(() => null)
      ]);
      const discoveredComponents = collectComponentCandidates(file.document);
      const components = mergeComponents(
        file.components || {},
        publishedComponents?.meta?.components || [],
        discoveredComponents
      );

      return res.status(200).json({
        fileName: file.name,
        lastModified: file.lastModified,
        version: file.version,
        pages: extractPages(file.document),
        components: await rankComponentsWithAi(components, file.name)
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

function mergeComponents(localComponents, publishedComponents, discoveredComponents = []) {
  const byNodeId = new Map();

  Object.entries(localComponents).forEach(([nodeId, component]) => {
    byNodeId.set(nodeId, {
      id: nodeId,
      key: component.key || null,
      name: component.name || nodeId,
      description: component.description || "",
      componentSetId: component.componentSetId || null,
      thumbnailUrl: component.thumbnail_url || component.thumbnailUrl || null,
      source: "local-component",
      discoveryScore: 100
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
      thumbnailUrl: component.thumbnail_url || component.thumbnailUrl || null,
      source: "published-component",
      discoveryScore: 100
    });
  });

  discoveredComponents.forEach((component) => {
    const existing = byNodeId.get(component.id);
    byNodeId.set(component.id, {
      ...component,
      ...existing,
      name: existing?.name || component.name,
      description: existing?.description || component.description,
      componentSetId: existing?.componentSetId || component.componentSetId,
      thumbnailUrl: existing?.thumbnailUrl || component.thumbnailUrl,
      source: existing?.source || component.source,
      discoveryScore: Math.max(existing?.discoveryScore || 0, component.discoveryScore || 0)
    });
  });

  return [...byNodeId.values()].sort((left, right) => {
    const scoreDelta = (right.discoveryScore || 0) - (left.discoveryScore || 0);
    return scoreDelta || left.name.localeCompare(right.name);
  });
}

function collectComponentCandidates(documentNode) {
  const candidates = [];
  const keywords = [
    "accordion",
    "alert",
    "avatar",
    "badge",
    "banner",
    "button",
    "card",
    "checkbox",
    "chip",
    "dialog",
    "drawer",
    "dropdown",
    "empty",
    "field",
    "input",
    "link",
    "list",
    "menu",
    "modal",
    "nav",
    "profile",
    "radio",
    "select",
    "sheet",
    "switch",
    "tab",
    "table",
    "toast",
    "toggle",
    "tooltip"
  ];

  walkNode(documentNode, (node, ancestry) => {
    if (!node?.id || !node?.name) return;

    const lowerName = node.name.toLowerCase();
    const typeScore = node.type === "COMPONENT_SET" ? 110 : node.type === "COMPONENT" ? 100 : node.type === "FRAME" ? 42 : 0;
    const propertyScore = Object.keys(node.componentPropertyDefinitions || {}).length * 8;
    const keywordScore = keywords.some((keyword) => lowerName.includes(keyword)) ? 30 : 0;
    const designSystemScore = ancestry.some((item) => /component|library|design system|foundation|ui kit/i.test(item.name || "")) ? 18 : 0;
    const layoutScore = node.layoutMode ? 10 : 0;
    const childScore = Math.min((node.children?.length || 0) * 2, 16);
    const discoveryScore = typeScore + propertyScore + keywordScore + designSystemScore + layoutScore + childScore;

    if (discoveryScore < 54) return;

    candidates.push({
      id: node.id,
      key: node.key || null,
      name: node.name,
      description: node.description || ancestry.map((item) => item.name).filter(Boolean).join(" / "),
      componentSetId: node.componentSetId || null,
      thumbnailUrl: null,
      source: node.type === "FRAME" ? "ai-candidate-frame" : "document-node",
      nodeType: node.type,
      discoveryScore
    });
  });

  return candidates.slice(0, 180);
}

function walkNode(node, visitor, ancestry = []) {
  if (!node) return;
  visitor(node, ancestry);
  (node.children || []).forEach((child) => walkNode(child, visitor, [...ancestry, node]));
}

async function rankComponentsWithAi(components, fileName) {
  const normalized = components.map((component) => ({
    ...component,
    aiRank: null,
    aiReason: component.source === "ai-candidate-frame"
      ? "Discovered from component-like naming, layout, and design-system location."
      : "Discovered from Figma component metadata."
  }));

  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) {
    return normalized;
  }

  try {
    const prompt = `Rank likely reusable design-system components from this Figma file named "${fileName}". Return JSON only as {"components":[{"id":"node-id","rank":1,"reason":"short reason"}]}. Components: ${JSON.stringify(normalized.slice(0, 80).map(({ id, name, source, nodeType, discoveryScore }) => ({ id, name, source, nodeType, discoveryScore })))}`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL,
        input: prompt,
        text: { format: { type: "json_object" } }
      })
    });
    if (!response.ok) return normalized;
    const payload = await response.json();
    const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).map((item) => item.text).join("") || "";
    const ranked = JSON.parse(text || "{}").components || [];
    const rankById = new Map(ranked.map((item) => [item.id, item]));

    return normalized
      .map((component) => ({
        ...component,
        aiRank: rankById.get(component.id)?.rank || null,
        aiReason: rankById.get(component.id)?.reason || component.aiReason
      }))
      .sort((left, right) => (left.aiRank || 999) - (right.aiRank || 999));
  } catch {
    return normalized;
  }
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
