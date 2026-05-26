const state = {
  token: "",
  fileKey: "",
  productName: "web-app",
  file: null,
  tokens: [],
  components: [],
  component: null,
  componentSpec: null,
  framework: "react",
  latestScore: null,
  runtime: null
};

const steps = [...document.querySelectorAll(".step")];
const panels = [...document.querySelectorAll(".panel")];
const componentSelect = document.querySelector("#componentSelect");
const frameworkSelect = document.querySelector("#frameworkSelect");
const teamPackage = document.querySelector("#teamPackage");
const codeSample = document.querySelector("#codeSample");
const generatedCode = document.querySelector("#generatedCode");
const generationStatus = document.querySelector("#generationStatus");
const latestScore = document.querySelector("#latestScore");
const statusDot = document.querySelector("#statusDot");
const statusLabel = document.querySelector("#statusLabel");
const statusDetail = document.querySelector("#statusDetail");
const mcpBase = document.querySelector("#mcpBase");
const apiKey = document.querySelector("#apiKey");

steps.forEach((step) => step.addEventListener("click", () => showPanel(step.dataset.panel)));

document.querySelector("#connectFile").addEventListener("click", connectFile);
document.querySelector("#forgetConnection").addEventListener("click", forgetConnection);
componentSelect.addEventListener("change", () => setComponent(componentSelect.value));
frameworkSelect.addEventListener("change", () => {
  state.framework = frameworkSelect.value;
  renderGeneratedCode();
  renderMcpPayload();
});
teamPackage.addEventListener("input", () => {
  renderGeneratedCode();
  renderClaudeConfig();
});
document.querySelector("#generateCode").addEventListener("click", renderGeneratedCode);
document.querySelector("#copyGeneratedCode").addEventListener("click", () => copyText(generatedCode.textContent, "#copyGeneratedCode"));
document.querySelector("#sendToValidator").addEventListener("click", () => {
  codeSample.value = generatedCode.textContent;
  showPanel("validate");
});
document.querySelector("#useGeneratedCode").addEventListener("click", () => {
  codeSample.value = generatedCode.textContent;
});
document.querySelector("#runValidation").addEventListener("click", runValidation);
document.querySelector("#checkRuntime").addEventListener("click", checkRuntime);
document.querySelector("#copyConfig").addEventListener("click", () => copyText(document.querySelector("#claudeConfig").textContent, "#copyConfig"));
document.querySelector("#copyProjectPitch")?.addEventListener("click", () => {
  copyText("Figma MCP Bridge connects a live Figma design system to AI coding agents, generates token-correct UI code, and scores implementations against the source design contract.", "#copyProjectPitch");
});

init();

function init() {
  renderEmptyState();
  renderClaudeConfig();
  renderReadiness({ mode: "not connected", products: [], sseAuthConfigured: false, webhookSecretConfigured: false });
}

async function connectFile() {
  const token = document.querySelector("#figmaToken").value.trim();
  const fileKey = normalizeFileKey(document.querySelector("#fileKey").value.trim());
  const productName = document.querySelector("#productName").value.trim() || "web-app";

  if (!token || !fileKey) {
    showNotice("Add a Figma access token and file key before connecting.", true);
    return;
  }

  setStatus("Connecting to Figma", "Reading file metadata and variables", "");
  showNotice("Connecting to your Figma file...");

  try {
    const file = await figmaApi("inspect", { token, fileKey });
    let tokenPayload = { tokens: [] };
    try {
      tokenPayload = await figmaApi("tokens", { token, fileKey });
    } catch (error) {
      showNotice(`File connected. Variables were not returned by Figma: ${error.message}`, true);
    }

    state.token = token;
    state.fileKey = fileKey;
    state.productName = productName;
    state.file = file;
    state.components = file.components || [];
    state.tokens = tokenPayload.tokens || [];
    state.component = state.components[0] || null;
    state.componentSpec = null;

    renderConnectedState();
    setStatus("Live Figma file connected", file.fileName || fileKey, "ok");
    showNotice("Connected. Your components and variables are now loaded from Figma.");
    if (state.component) {
      await setComponent(state.component.id);
      showPanel("components");
    } else {
      showPanel("components");
    }
  } catch (error) {
    setStatus("Figma connection failed", error.message, "bad");
    showNotice(error.message, true);
  }
}

function forgetConnection() {
  state.token = "";
  state.fileKey = "";
  state.file = null;
  state.tokens = [];
  state.components = [];
  state.component = null;
  state.componentSpec = null;
  document.querySelector("#figmaToken").value = "";
  document.querySelector("#fileKey").value = "";
  renderEmptyState();
  showPanel("connect");
  setStatus("No Figma file connected", "Connect a live file to begin", "");
  showNotice("Credentials cleared from this browser session.");
}

async function figmaApi(action, payload) {
  const response = await fetch("/api/figma", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Request failed with ${response.status}`);
  }
  return result;
}

function renderEmptyState() {
  document.querySelector("#componentCount").textContent = "--";
  document.querySelector("#tokenCount").textContent = "--";
  document.querySelector("#aiCount").textContent = "--";
  latestScore.textContent = "--";
  document.querySelector("#currentFileName").textContent = "Waiting for Figma";
  document.querySelector("#currentComponentName").textContent = "None selected";
  document.querySelector("#currentScoreLabel").textContent = "Not scored yet";
  componentSelect.innerHTML = '<option value="">Connect a Figma file first</option>';
  generatedCode.textContent = "Connect a Figma file to generate code from a real component.";
  generationStatus.textContent = "Connect a Figma file, select a component, then generate code.";
  codeSample.value = "";
  document.querySelector("#componentList").innerHTML = emptyCard("Connect a Figma file to load its component inventory.");
  document.querySelector("#componentPreview").innerHTML = emptyInline("No live component selected.");
  document.querySelector("#componentDetailPreview").innerHTML = emptyInline("No live component selected.");
  document.querySelector("#figmaComparePreview").innerHTML = emptyInline("No live component selected.");
  document.querySelector("#generatedComparePreview").innerHTML = emptyInline("Generated simulation appears after code generation.");
  document.querySelector("#aiReason").textContent = "AI discovery will explain why a node was surfaced after connection.";
  document.querySelector("#contractList").innerHTML = "";
  document.querySelector("#componentDetails").innerHTML = "";
  document.querySelector("#componentResource").textContent = "";
  document.querySelector("#tokenGrid").innerHTML = emptyCard("Connect a Figma file with local variables to inspect design tokens.");
  document.querySelector("#tokenJson").textContent = "";
  document.querySelector("#issueList").innerHTML = "<li><strong>ready</strong>: Connect a file and paste implementation code to score it.</li>";
  document.querySelector("#scoreValue").textContent = "--";
  document.querySelector("#scoreBar").style.width = "0";
  renderFileReadiness();
  renderMcpPayload();
}

function renderConnectedState() {
  const aiCandidates = state.components.filter((component) => component.source === "ai-candidate-frame" || component.aiRank).length;
  document.querySelector("#componentCount").textContent = String(state.components.length);
  document.querySelector("#tokenCount").textContent = String(state.tokens.length);
  document.querySelector("#aiCount").textContent = String(aiCandidates);
  document.querySelector("#currentFileName").textContent = state.file?.fileName || state.fileKey;
  componentSelect.innerHTML = state.components.length
    ? state.components.map((component) => `<option value="${escapeHtml(component.id)}">${escapeHtml(component.name)}</option>`).join("")
    : '<option value="">No components found</option>';
  renderComponentList();
  renderTokens();
  renderFileReadiness();
  renderClaudeConfig();
  renderMcpPayload();
}

function showPanel(id) {
  steps.forEach((step) => step.classList.toggle("is-active", step.dataset.panel === id));
  panels.forEach((panel) => {
    const active = panel.id === id;
    panel.classList.toggle("is-visible", active);
    panel.setAttribute("aria-hidden", active ? "false" : "true");
  });
  const titles = {
    connect: "Source",
    workspace: "Overview",
    components: "Library",
    generate: "Build",
    validate: "Review",
    agent: "Agent"
  };
  document.querySelector("#panelTitle").textContent = titles[id] || "Workspace";
  document.querySelector(".workspace")?.scrollTo({ top: 0, behavior: "smooth" });
}

async function setComponent(id, focusInspector = false) {
  const component = state.components.find((item) => item.id === id) || state.components[0] || null;
  state.component = component;
  state.componentSpec = null;

  if (!component) {
    renderEmptyState();
    return;
  }

  componentSelect.value = component.id;
  document.querySelector("#currentComponentName").textContent = component.name;
  renderComponentList();
  renderComponentPreview("#componentPreview", component);
  renderComponentPreview("#componentDetailPreview", component);
  renderComponentPreview("#figmaComparePreview", component);
  renderGeneratedSimulation();
  renderContract("#contractList", component);
  renderContract("#componentDetails", component);
  document.querySelector("#componentDetailTitle").textContent = component.name;
  renderAiReason(component);
  document.querySelector("#componentResource").textContent = JSON.stringify(componentResource(component), null, 2);
  renderGeneratedCode();
  renderMcpPayload();
  if (focusInspector) {
    revealInspector();
  }

  if (state.token && state.fileKey) {
    try {
      renderPreviewLoading(component);
      const [componentResult, exportResult] = await Promise.all([
        figmaApi("component", { token: state.token, fileKey: state.fileKey, nodeId: component.id }),
        figmaApi("export", { token: state.token, fileKey: state.fileKey, nodeId: component.id, format: "svg" }).catch(() => ({ url: null }))
      ]);
      if (state.component?.id !== component.id) return;
      state.componentSpec = componentResult.component;
      if (exportResult.url) {
        component.previewUrl = exportResult.url;
      }
      renderComponentPreview("#componentPreview", component);
      renderComponentPreview("#componentDetailPreview", component);
      renderComponentPreview("#figmaComparePreview", component);
      renderContract("#contractList", component);
      renderContract("#componentDetails", component);
      document.querySelector("#componentResource").textContent = JSON.stringify(componentResource(component), null, 2);
      renderGeneratedCode();
      renderGeneratedSimulation();
    } catch (error) {
      showNotice(`Component metadata was partially loaded: ${error.message}`, true);
      renderComponentPreview("#componentPreview", component);
      renderComponentPreview("#componentDetailPreview", component);
      renderComponentPreview("#figmaComparePreview", component);
    }
  }
}

function revealInspector() {
  const inspector = document.querySelector("#componentInspector");
  if (!inspector) return;
  if (window.matchMedia("(max-width: 980px)").matches) {
    inspector.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderComponentList() {
  if (!state.components.length) {
    document.querySelector("#componentList").innerHTML = emptyCard("No components were found in this Figma file.");
    return;
  }

  document.querySelector("#componentList").innerHTML = state.components.map((component) => (
    `<button class="component-card ${component.id === state.component?.id ? "is-selected" : ""}" data-component="${escapeHtml(component.id)}">
      <strong>${escapeHtml(component.name)}</strong>
      <span class="source-pill">${escapeHtml(sourceLabel(component))}</span>
      <small>${escapeHtml(component.description || component.id)}</small>
    </button>`
  )).join("");
  document.querySelectorAll("[data-component]").forEach((button) => {
    button.addEventListener("click", () => setComponent(button.dataset.component, true));
  });
}

function renderAiReason(component) {
  document.querySelector("#aiReason").textContent = `${sourceLabel(component)}: ${component.aiReason || "Detected from Figma metadata and design-system structure."}`;
}

function renderComponentPreview(target, component) {
  const imageUrl = component.previewUrl || component.thumbnailUrl;
  const image = imageUrl
    ? `<img class="figma-thumb" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(component.name)} preview">`
    : `<div class="live-node"><strong>${escapeHtml(component.name)}</strong><span>Preview export pending for ${escapeHtml(component.id)}</span></div>`;
  document.querySelector(target).innerHTML = image;
}

function renderPreviewLoading(component) {
  const markup = `<div class="live-node"><strong>${escapeHtml(component.name)}</strong><span>Loading Figma export preview...</span></div>`;
  document.querySelector("#componentPreview").innerHTML = markup;
  document.querySelector("#componentDetailPreview").innerHTML = markup;
  document.querySelector("#figmaComparePreview").innerHTML = markup;
}

function renderContract(target, component) {
  const spec = state.componentSpec;
  const props = spec?.props?.length
    ? spec.props.map((prop) => `${prop.name}${prop.variantOptions?.length ? ` (${prop.variantOptions.join(", ")})` : ""}`).join(", ")
    : "No component properties returned";
  const rows = [
    ["Figma node", component.id],
    ["Description", component.description || "No description in Figma"],
    ["Component set", component.componentSetId || "Not grouped"],
    ["Layout", spec?.layoutMode || "Load returned no auto-layout mode"],
    ["Size", spec?.size?.width ? `${Math.round(spec.size.width)} x ${Math.round(spec.size.height)}px` : "Not available"],
    ["Spacing", spec?.itemSpacing != null ? `${spec.itemSpacing}px gap` : "Not available"],
    ["Padding", paddingLabel(spec?.padding)],
    ["Props", props]
  ];
  document.querySelector(target).innerHTML = rows.map(([key, value]) => (
    `<div><dt>${key}</dt><dd>${escapeHtml(value)}</dd></div>`
  )).join("");
}

function renderTokens() {
  if (!state.tokens.length) {
    document.querySelector("#tokenGrid").innerHTML = emptyCard("No local variables were returned. Check Figma plan, file permissions, and Variables API access.");
    document.querySelector("#tokenJson").textContent = JSON.stringify({ tokens: [] }, null, 2);
    return;
  }

  const groups = groupBy(state.tokens, "collection");
  document.querySelector("#tokenGrid").innerHTML = Object.entries(groups).map(([collection, tokens]) => (
    `<article class="token-card">
      <h4>${escapeHtml(collection)}</h4>
      ${tokens.slice(0, 16).map(tokenRow).join("")}
      ${tokens.length > 16 ? `<small>${tokens.length - 16} more tokens in this collection</small>` : ""}
    </article>`
  )).join("");
  document.querySelector("#tokenJson").textContent = JSON.stringify(toStyleDictionary(), null, 2);
}

function tokenRow(token) {
  const swatch = /^#|^rgb/.test(token.cssValue || "") ? `<span class="swatch" style="background:${escapeHtml(token.cssValue)}"></span>` : "";
  return `<div class="swatch-row">${swatch}<div><strong>${escapeHtml(token.name)}</strong><br><small>var(${escapeHtml(token.cssName)}) = ${escapeHtml(token.cssValue)}</small></div></div>`;
}

function renderGeneratedCode() {
  if (!state.component) {
    generatedCode.textContent = "Connect a Figma file and select a component first.";
    generationStatus.textContent = "Code generation needs a connected Figma component.";
    renderGeneratedSimulation();
    return;
  }

  const code = state.framework === "react"
    ? generateReactCode(state.component)
    : state.framework === "vue"
      ? generateVueCode(state.component)
      : generateSvelteCode(state.component);
  generatedCode.textContent = code;
  generationStatus.textContent = `${componentName(state.component.name)} ${labelForFramework(state.framework)} scaffold generated from the selected Figma component.`;
  renderComponentPreview("#figmaComparePreview", state.component);
  renderGeneratedSimulation();
}

function renderGeneratedSimulation() {
  const target = document.querySelector("#generatedComparePreview");
  if (!state.component) {
    target.innerHTML = emptyInline("Generated simulation appears after code generation.");
    return;
  }

  const styleVars = state.tokens
    .filter((token) => token.cssName && token.cssValue)
    .slice(0, 80)
    .map((token) => `${token.cssName}: ${token.cssValue}`)
    .join(";");
  const spec = state.componentSpec || {};
  const width = spec.size?.width ? Math.min(Math.max(Math.round(spec.size.width), 180), 520) : 320;
  const height = spec.size?.height ? Math.min(Math.max(Math.round(spec.size.height), 56), 260) : 96;
  const padding = paddingLabel(spec.padding) === "Not available" ? "var(--sim-space)" : paddingLabel(spec.padding);
  const gap = spec.itemSpacing != null ? `${spec.itemSpacing}px` : "12px";

  target.innerHTML = `
    <div class="sim-canvas" style="${escapeHtml(styleVars)}">
      <div class="sim-component" style="width:${width}px; min-height:${height}px; padding:${escapeHtml(padding)}; gap:${escapeHtml(gap)};">
        <span class="sim-kicker">${escapeHtml(labelForFramework(state.framework))}</span>
        <strong>${escapeHtml(state.component.name)}</strong>
        <small>Tokenized scaffold preview</small>
      </div>
    </div>
  `;
}

function generateReactCode(component) {
  const name = componentName(component.name);
  const props = [
    ...propNames().map((prop) => `${prop}?: string | boolean`),
    "children?: React.ReactNode"
  ].join(";\n  ");
  return `import { ${name} as Base${name} } from "${teamPackage.value || "@company/ui"}";

type ${name}Props = {
  ${props};
};

export function ${name}({ children, ...props }: ${name}Props) {
  return (
    <Base${name}
      {...props}
      data-figma-node="${component.id}"
      style={{
        color: "var(${tokenName("color")})",
        background: "var(${tokenName("surface")})",
        padding: "var(${tokenName("spacing")})",
        borderRadius: "var(${tokenName("radius")})",
        maxWidth: "100%"
      }}
      aria-label={typeof children === "string" ? children : "${component.name}"}
    >
      {children}
    </Base${name}>
  );
}`;
}

function generateVueCode(component) {
  const name = componentName(component.name);
  return `<script setup lang="ts">
import { ${name} as Base${name} } from "${teamPackage.value || "@company/ui"}";

defineProps<{
  ${propNames().map((prop) => `${prop}?: string | boolean`).join(";\n  ")}
}>();
</script>

<template>
  <Base${name}
    data-figma-node="${component.id}"
    aria-label="${component.name}"
    :style="{
      color: 'var(${tokenName("color")})',
      background: 'var(${tokenName("surface")})',
      padding: 'var(${tokenName("spacing")})',
      borderRadius: 'var(${tokenName("radius")})',
      maxWidth: '100%'
    }"
  >
    <slot />
  </Base${name}>
</template>`;
}

function generateSvelteCode(component) {
  const name = componentName(component.name);
  return `<script lang="ts">
  import { ${name} as Base${name} } from "${teamPackage.value || "@company/ui"}";
  ${propNames().map((prop) => `export let ${prop}: string | boolean | undefined = undefined;`).join("\n  ")}
</script>

<Base${name}
  data-figma-node="${component.id}"
  aria-label="${component.name}"
  style="color: var(${tokenName("color")}); background: var(${tokenName("surface")}); padding: var(${tokenName("spacing")}); border-radius: var(${tokenName("radius")}); max-width: 100%;"
>
  <slot />
</Base${name}>`;
}

function runValidation() {
  if (!state.component) {
    showNotice("Connect a Figma file and select a component before validating code.", true);
    return;
  }
  const result = validateImplementation(codeSample.value, state.component);
  state.latestScore = result.score;
  latestScore.textContent = String(result.score);
  document.querySelector("#currentScoreLabel").textContent = `${result.score}/100`;
  document.querySelector("#scoreValue").textContent = String(result.score);
  const scoreBar = document.querySelector("#scoreBar");
  scoreBar.style.width = `${result.score}%`;
  scoreBar.style.background = result.score >= 90 ? "var(--ok)" : result.score >= 70 ? "var(--warn)" : "var(--bad)";
  document.querySelector("#issueList").innerHTML = result.issues.length
    ? result.issues.map((issue) => `<li><strong>${issue.severity}</strong>: ${escapeHtml(issue.message)}</li>`).join("")
    : "<li><strong>pass</strong>: Implementation follows the connected Figma design contract.</li>";
}

function validateImplementation(code, component) {
  const issues = [];
  const rawColors = code.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) || [];
  const pxValues = code.match(/\b\d+(?:\.\d+)?px\b/g) || [];
  const tokenCssNames = new Set(state.tokens.map((token) => token.cssName));
  const tokenCssValues = new Set(state.tokens.map((token) => token.cssValue).filter(Boolean));
  const codeTokenRefs = [...code.matchAll(/var\((--[a-zA-Z0-9-_]+)\)/g)].map((match) => match[1]);

  rawColors.forEach((color) => {
    issues.push({ severity: "error", message: `Raw color ${color} should reference a Figma variable token.` });
  });

  pxValues.filter((value) => !tokenCssValues.has(value)).forEach((value) => {
    issues.push({ severity: "warning", message: `${value} is not in the connected spacing, radius, or type scale.` });
  });

  if (state.tokens.length && !codeTokenRefs.some((token) => tokenCssNames.has(token))) {
    issues.push({ severity: "warning", message: "No connected Figma token references were found." });
  }

  codeTokenRefs.filter((token) => state.tokens.length && !tokenCssNames.has(token)).forEach((token) => {
    issues.push({ severity: "info", message: `${token} is not present in the connected Figma variables.` });
  });

  if (!/aria-|role=|<button|<Base/.test(code)) {
    issues.push({ severity: "warning", message: "No native semantic element or ARIA attribute found." });
  }

  propNames().forEach((prop) => {
    if (!code.includes(prop)) {
      issues.push({ severity: "info", message: `Prop '${prop}' from the Figma component metadata is not represented.` });
    }
  });

  if (!/maxWidth|max-width|width:\s*100%|grid|flex|@media/.test(code)) {
    issues.push({ severity: "info", message: "No responsive layout hint found." });
  }

  if (!code.includes(component.id)) {
    issues.push({ severity: "info", message: "Generated traceability to the Figma node is missing." });
  }

  const penalty = issues.reduce((sum, issue) => sum + (issue.severity === "error" ? 25 : issue.severity === "warning" ? 12 : 4), 0);
  return { score: Math.max(0, 100 - penalty), issues };
}

async function checkRuntime() {
  const baseUrl = mcpBase.value.replace(/\/$/, "");
  if (!baseUrl) {
    setStatus("Add runtime URL", "Use your private MCP SSE deployment", "");
    return;
  }
  setStatus("Checking runtime", "Calling /ready", "");
  try {
    const headers = {};
    if (apiKey.value) headers.Authorization = `Bearer ${apiKey.value}`;
    const response = await fetch(`${baseUrl}/ready`, { headers });
    const readiness = await response.json();
    state.runtime = { baseUrl, readiness };
    setStatus(readiness.ok ? "Runtime ready" : "Runtime incomplete", readiness.mode || "unknown", readiness.ok ? "ok" : "bad");
    renderReadiness(readiness);
  } catch (error) {
    setStatus("Runtime unavailable", error.message, "bad");
    renderReadiness({ mode: "unreachable", products: [], sseAuthConfigured: false, webhookSecretConfigured: false });
  }
}

function renderFileReadiness() {
  const items = [
    ["Connection", state.file ? "live Figma file" : "not connected"],
    ["File", state.file?.fileName || "waiting"],
    ["Components", state.components.length ? String(state.components.length) : "waiting"],
    ["Variables", state.tokens.length ? String(state.tokens.length) : "waiting"]
  ];
  document.querySelector("#fileReadiness").innerHTML = items.map(([label, value]) => (
    `<div class="ready-item"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`
  )).join("");
}

function renderReadiness(readiness) {
  const items = [
    ["Mode", readiness.mode || "unknown"],
    ["Products", (readiness.products || []).join(", ") || state.productName],
    ["SSE auth", readiness.sseAuthConfigured ? "configured" : "not configured"],
    ["Webhook secret", readiness.webhookSecretConfigured ? "configured" : "not configured"]
  ];
  document.querySelector("#readinessList").innerHTML = items.map(([label, value]) => (
    `<div class="ready-item"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`
  )).join("");
}

function renderClaudeConfig() {
  const config = {
    mcpServers: {
      "figma-design-system": {
        command: "npx",
        args: ["tsx", "/absolute/path/to/figma-mcp-bridge/src/mcp-server/index.ts"],
        env: {
          FIGMA_MODE: "production",
          FIGMA_ACCESS_TOKEN: "figd_...",
          FIGMA_FILE_KEY: state.fileKey || "your_file_key",
          FIGMA_PRODUCT: state.productName,
          CODEGEN_TEAM_PACKAGE: teamPackage.value || "@company/ui"
        }
      }
    }
  };
  document.querySelector("#claudeConfig").textContent = JSON.stringify(config, null, 2);
  renderMcpPayload();
}

function renderMcpPayload() {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "extract_component_code",
      arguments: {
        component_name: state.component?.name || "Select a connected Figma component",
        framework: state.framework,
        product: state.productName
      }
    }
  };
  document.querySelector("#mcpPayload").textContent = JSON.stringify(payload, null, 2);
}

function componentResource(component) {
  return {
    uri: `figma://products/${state.productName}/components/${component.name}`,
    fileKey: state.fileKey,
    nodeId: component.id,
    name: component.name,
    description: component.description,
    componentSetId: component.componentSetId,
    source: component.source,
    aiRank: component.aiRank,
    aiReason: component.aiReason,
    figmaSpec: state.componentSpec
  };
}

function toStyleDictionary() {
  const result = {};
  state.tokens.forEach((token) => {
    const path = token.name.split("/").map((part) => part.trim()).filter(Boolean);
    const family = token.type?.toLowerCase() || "token";
    const keyPath = [family, ...path];
    let cursor = result;
    keyPath.forEach((key, index) => {
      if (index === keyPath.length - 1) {
        cursor[key] = { value: token.cssValue, type: token.type, css: `var(${token.cssName})` };
      } else {
        cursor[key] ||= {};
        cursor = cursor[key];
      }
    });
  });
  return result;
}

function propNames() {
  const props = state.componentSpec?.props?.map((prop) => safeIdentifier(prop.name)) || [];
  return [...new Set(props.filter(Boolean))].slice(0, 8);
}

function tokenName(kind) {
  const lower = kind.toLowerCase();
  const byName = state.tokens.find((token) => token.name.toLowerCase().includes(lower));
  const byType = state.tokens.find((token) => {
    if (lower === "color" || lower === "surface") return token.type === "COLOR";
    if (lower === "spacing" || lower === "radius") return token.type === "FLOAT";
    return false;
  });
  return (byName || byType)?.cssName || `--figma-${lower}`;
}

function componentName(name) {
  const words = String(name)
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("") || "FigmaComponent";
}

function safeIdentifier(name) {
  const camel = String(name)
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/^[^a-zA-Z_$]+/, "");
  return camel.charAt(0).toLowerCase() + camel.slice(1);
}

function paddingLabel(padding) {
  if (!padding || Object.values(padding).every((value) => value == null)) return "Not available";
  return `${padding.top ?? 0}px ${padding.right ?? 0}px ${padding.bottom ?? 0}px ${padding.left ?? 0}px`;
}

function groupBy(items, key) {
  return items.reduce((groups, item) => {
    const value = item[key] || "Other";
    groups[value] ||= [];
    groups[value].push(item);
    return groups;
  }, {});
}

function normalizeFileKey(input) {
  const match = input.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  return match ? match[1] : input;
}

function showNotice(message, isError = false) {
  const notice = document.querySelector("#connectionNotice");
  notice.textContent = message;
  notice.classList.toggle("error", isError);
}

function emptyCard(message) {
  return `<div class="empty-card">${escapeHtml(message)}</div>`;
}

function emptyInline(message) {
  return `<div class="live-node"><strong>${escapeHtml(message)}</strong><span>Connect Figma to populate this area.</span></div>`;
}

function sourceLabel(component) {
  if (component.aiRank) return `AI ranked #${component.aiRank}`;
  if (component.source === "ai-candidate-frame") return "AI discovered frame";
  if (component.source === "published-component") return "Published component";
  if (component.source === "local-component") return "Local component";
  return "Figma node";
}

async function copyText(text, selector) {
  const button = document.querySelector(selector);
  const original = button.textContent;
  try {
    if (!text || /^Connect a Figma file/.test(text)) {
      throw new Error("There is no generated code to copy yet.");
    }
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
    showToast("Copied to clipboard");
    setTimeout(() => {
      button.textContent = original;
    }, 1400);
  } catch (error) {
    button.textContent = "Copy failed";
    showToast(error.message || "Copy failed", true);
    setTimeout(() => {
      button.textContent = original;
    }, 1800);
  }
}

function showToast(message, isError = false) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2200);
}

function setStatus(label, detail, tone) {
  statusLabel.textContent = label;
  statusDetail.textContent = detail;
  statusDot.className = `dot ${tone || ""}`.trim();
}

function labelForFramework(framework) {
  return framework.charAt(0).toUpperCase() + framework.slice(1);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
