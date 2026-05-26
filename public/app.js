const state = {
  baseUrl: window.location.origin,
  readiness: null,
  selectedResource: "figma://design-tokens"
};

const steps = [...document.querySelectorAll(".step")];
const panels = [...document.querySelectorAll(".panel")];
const resources = [...document.querySelectorAll(".resource")];
const mcpBase = document.querySelector("#mcpBase");
const apiKey = document.querySelector("#apiKey");
const statusDot = document.querySelector("#statusDot");
const statusLabel = document.querySelector("#statusLabel");
const statusDetail = document.querySelector("#statusDetail");
const modeValue = document.querySelector("#modeValue");
const productValue = document.querySelector("#productValue");

mcpBase.value = state.baseUrl;

steps.forEach((step) => {
  step.addEventListener("click", () => showPanel(step.dataset.step));
});

resources.forEach((resource) => {
  resource.addEventListener("click", () => {
    resources.forEach((item) => item.classList.toggle("is-selected", item === resource));
    state.selectedResource = resource.dataset.uri;
    renderResourcePayload();
  });
});

document.querySelector("#checkRuntime").addEventListener("click", checkRuntime);
document.querySelector("#buildCodegen").addEventListener("click", renderCodegenPayload);
document.querySelector("#buildValidation").addEventListener("click", renderValidationPayload);
document.querySelector("#copyConfig").addEventListener("click", copyClaudeConfig);

renderResourcePayload();
renderCodegenPayload();
renderValidationPayload();
checkRuntime();

function showPanel(id) {
  steps.forEach((step) => step.classList.toggle("is-active", step.dataset.step === id));
  panels.forEach((panel) => panel.classList.toggle("is-visible", panel.id === id));
  const titles = {
    connect: "Connect MCP runtime",
    tokens: "Inspect design resources",
    codegen: "Build codegen payload",
    validate: "Score implementation",
    handoff: "Share the system"
  };
  document.querySelector("#panelTitle").textContent = titles[id] || "Design system wizard";
}

async function checkRuntime() {
  state.baseUrl = mcpBase.value.replace(/\/$/, "") || window.location.origin;
  setStatus("Checking runtime", "Calling /ready", "");
  try {
    const readiness = await fetchJson("/ready");
    state.readiness = readiness;
    modeValue.textContent = readiness.mode || "unknown";
    productValue.textContent = `${(readiness.products || []).length} products`;
    setStatus(readiness.ok ? "Runtime ready" : "Runtime incomplete", readiness.mode || "unknown", readiness.ok ? "ok" : "bad");
    renderReadiness(readiness);
  } catch (error) {
    modeValue.textContent = "-";
    productValue.textContent = "not connected";
    setStatus("Runtime unavailable", error.message, "bad");
    renderReadiness({
      mode: "unknown",
      products: [],
      sseAuthConfigured: false,
      webhookSecretConfigured: false,
      error: error.message
    });
  }
}

function renderReadiness(readiness) {
  const items = [
    ["Mode", readiness.mode || "unknown"],
    ["Products", (readiness.products || []).join(", ") || "none reported"],
    ["SSE auth", readiness.sseAuthConfigured ? "configured" : "not configured"],
    ["Webhook secret", readiness.webhookSecretConfigured ? "configured" : "not configured"]
  ];
  document.querySelector("#readinessList").innerHTML = items.map(([label, value]) => (
    `<div class="ready-item"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`
  )).join("");
}

function renderResourcePayload() {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "resources/read",
    params: {
      uri: state.selectedResource
    }
  };
  document.querySelector("#resourceOutput").textContent = JSON.stringify(payload, null, 2);
}

function renderCodegenPayload() {
  const component = document.querySelector("#componentName").value || "ProfileCard";
  const framework = document.querySelector("#frameworkName").value || "react";
  const payload = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "extract_component_code",
      arguments: {
        component_name: component,
        framework,
        product: firstProduct()
      }
    }
  };
  document.querySelector("#codegenOutput").textContent = JSON.stringify(payload, null, 2);
}

function renderValidationPayload() {
  const payload = {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "validate_implementation",
      arguments: {
        component_name: document.querySelector("#componentName").value || "ProfileCard",
        product: firstProduct(),
        code: document.querySelector("#codeSample").value
      }
    }
  };
  document.querySelector("#validationOutput").textContent = JSON.stringify(payload, null, 2);
}

async function copyClaudeConfig() {
  const config = {
    mcpServers: {
      "figma-design-system": {
        command: "npx",
        args: ["tsx", "/absolute/path/to/figma-mcp-bridge/src/mcp-server/index.ts"],
        env: {
          FIGMA_MODE: "production",
          FIGMA_ACCESS_TOKEN: "figd_...",
          FIGMA_FILES_CONFIG: "/absolute/path/to/figma.files.json",
          FIGMA_PRODUCT: firstProduct() || "web-app"
        }
      }
    }
  };
  await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
  document.querySelector("#copyConfig").textContent = "Copied config";
}

async function fetchJson(path) {
  const headers = {};
  if (apiKey.value) headers.Authorization = `Bearer ${apiKey.value}`;
  const response = await fetch(`${state.baseUrl}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function firstProduct() {
  return state.readiness?.products?.[0] || "web-app";
}

function setStatus(label, detail, tone) {
  statusLabel.textContent = label;
  statusDetail.textContent = detail;
  statusDot.className = `dot ${tone || ""}`.trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
