const demo = {
  product: "SaaS Web App",
  tokens: {
    color: {
      primary: { value: "#0E7490", css: "var(--ds-color-primary)" },
      surface: { value: "#FFFFFF", css: "var(--ds-color-surface)" },
      ink: { value: "#182132", css: "var(--ds-color-ink)" },
      muted: { value: "#66758C", css: "var(--ds-color-muted)" }
    },
    spacing: {
      sm: { value: "8px", css: "var(--ds-spacing-sm)" },
      md: { value: "16px", css: "var(--ds-spacing-md)" },
      lg: { value: "24px", css: "var(--ds-spacing-lg)" }
    },
    typography: {
      body: { value: "16px", css: "var(--ds-type-body)" },
      title: { value: "24px", css: "var(--ds-type-title)" }
    },
    radius: {
      sm: { value: "6px", css: "var(--ds-radius-sm)" },
      md: { value: "8px", css: "var(--ds-radius-md)" }
    }
  },
  components: [
    {
      name: "Button",
      description: "Primary command button",
      variants: ["primary", "secondary", "ghost"],
      props: ["variant", "size", "loading", "children"],
      spacing: "12px 18px",
      radius: "var(--ds-radius-md)",
      aria: "native button plus aria-busy when loading",
      responsive: "fixed height, flexible label",
      resource: "figma://components/Button"
    },
    {
      name: "ProfileCard",
      description: "User profile summary card",
      variants: ["compact", "expanded"],
      props: ["name", "role", "avatarUrl", "status"],
      spacing: "var(--ds-spacing-md)",
      radius: "var(--ds-radius-md)",
      aria: "article with aria-label",
      responsive: "single column on mobile, media row on desktop",
      resource: "figma://components/ProfileCard"
    },
    {
      name: "ToggleRow",
      description: "Settings row with switch control",
      variants: ["on", "off", "disabled"],
      props: ["label", "description", "checked", "disabled"],
      spacing: "var(--ds-spacing-md)",
      radius: "var(--ds-radius-md)",
      aria: "switch role with aria-checked",
      responsive: "label wraps before switch",
      resource: "figma://components/ToggleRow"
    },
    {
      name: "EmptyState",
      description: "Empty data state with action",
      variants: ["neutral", "success", "warning"],
      props: ["title", "message", "actionLabel"],
      spacing: "var(--ds-spacing-lg)",
      radius: "var(--ds-radius-md)",
      aria: "section labelled by title",
      responsive: "centered content with max width",
      resource: "figma://components/EmptyState"
    }
  ]
};

const state = {
  component: demo.components[0],
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
const latestScore = document.querySelector("#latestScore");
const statusDot = document.querySelector("#statusDot");
const statusLabel = document.querySelector("#statusLabel");
const statusDetail = document.querySelector("#statusDetail");
const mcpBase = document.querySelector("#mcpBase");
const apiKey = document.querySelector("#apiKey");

steps.forEach((step) => {
  step.addEventListener("click", () => showPanel(step.dataset.panel));
});

componentSelect.addEventListener("change", () => setComponent(componentSelect.value));
frameworkSelect.addEventListener("change", () => {
  state.framework = frameworkSelect.value;
  document.querySelector("#currentFrameworkName").textContent = labelForFramework(state.framework);
  renderGeneratedCode();
  renderMcpPayload();
});

document.querySelector("#generateCode").addEventListener("click", renderGeneratedCode);
document.querySelector("#copyGeneratedCode").addEventListener("click", () => copyText(generatedCode.textContent, "#copyGeneratedCode"));
document.querySelector("#sendToValidator").addEventListener("click", () => {
  codeSample.value = generatedCode.textContent;
  showPanel("validate");
});
document.querySelector("#runValidation").addEventListener("click", runValidation);
document.querySelector("#loadGoodSample").addEventListener("click", () => {
  codeSample.value = generateReactCode(state.component);
  runValidation();
});
document.querySelector("#loadBadSample").addEventListener("click", () => {
  codeSample.value = badSampleFor(state.component);
  runValidation();
});
document.querySelector("#checkRuntime").addEventListener("click", checkRuntime);
document.querySelector("#copyConfig").addEventListener("click", () => copyText(document.querySelector("#claudeConfig").textContent, "#copyConfig"));
document.querySelector("#copyProjectPitch").addEventListener("click", () => {
  copyText(
    "Figma MCP Bridge turns Figma design systems into AI-agent-readable resources, generates token-correct UI code, and scores implementations against the source design contract.",
    "#copyProjectPitch"
  );
});

init();

function init() {
  document.querySelector("#componentCount").textContent = String(demo.components.length);
  componentSelect.innerHTML = demo.components
    .map((component) => `<option value="${component.name}">${component.name}</option>`)
    .join("");
  renderComponentList();
  renderTokens();
  setComponent(state.component.name);
  codeSample.value = generateReactCode(state.component);
  latestScore.textContent = "--";
  document.querySelector("#currentScoreLabel").textContent = "Ready to score";
  document.querySelector("#issueList").innerHTML = "<li><strong>ready</strong>: Run validation to score the current implementation.</li>";
  renderReadiness({
    mode: "demo dashboard",
    products: [demo.product],
    sseAuthConfigured: false,
    webhookSecretConfigured: false
  });
  renderClaudeConfig();
}

function showPanel(id) {
  steps.forEach((step) => step.classList.toggle("is-active", step.dataset.panel === id));
  panels.forEach((panel) => panel.classList.toggle("is-visible", panel.id === id));
  const titles = {
    workspace: "Workspace",
    components: "Components",
    tokens: "Tokens",
    generate: "Generate code",
    validate: "Validate code",
    connect: "Connect live Figma"
  };
  document.querySelector("#panelTitle").textContent = titles[id] || "Workspace";
}

function setComponent(name) {
  state.component = demo.components.find((component) => component.name === name) || demo.components[0];
  componentSelect.value = state.component.name;
  document.querySelector("#currentComponentName").textContent = state.component.name;
  renderComponentList();
  renderComponentPreview("#componentPreview", state.component);
  renderComponentPreview("#componentDetailPreview", state.component);
  renderContract("#contractList", state.component);
  renderContract("#componentDetails", state.component);
  document.querySelector("#componentDetailTitle").textContent = state.component.name;
  document.querySelector("#componentResource").textContent = JSON.stringify(componentResource(state.component), null, 2);
  renderGeneratedCode();
  renderMcpPayload();
}

function renderComponentList() {
  document.querySelector("#componentList").innerHTML = demo.components.map((component) => (
    `<button class="component-card ${component.name === state.component.name ? "is-selected" : ""}" data-component="${component.name}">
      <strong>${component.name}</strong>
      <small>${component.description}</small>
    </button>`
  )).join("");
  document.querySelectorAll("[data-component]").forEach((button) => {
    button.addEventListener("click", () => setComponent(button.dataset.component));
  });
}

function renderComponentPreview(target, component) {
  const html = {
    Button: '<button class="preview-button">Save changes</button>',
    ProfileCard: '<article class="preview-card"><div class="preview-avatar"></div><strong>Alex Morgan</strong><span>Design Systems Lead</span></article>',
    ToggleRow: '<div class="preview-toggle"><div><strong>Email alerts</strong><br><span>Product and security updates</span></div><span class="switch"></span></div>',
    EmptyState: '<div class="preview-empty"><strong>No components selected</strong><span>Choose a component to generate code.</span><button class="preview-button">Browse library</button></div>'
  };
  document.querySelector(target).innerHTML = html[component.name] || html.Button;
}

function renderContract(target, component) {
  const rows = [
    ["Resource", component.resource],
    ["Variants", component.variants.join(", ")],
    ["Props", component.props.join(", ")],
    ["Spacing", component.spacing],
    ["Radius", component.radius],
    ["A11y", component.aria],
    ["Responsive", component.responsive]
  ];
  document.querySelector(target).innerHTML = rows.map(([key, value]) => (
    `<div><dt>${key}</dt><dd>${escapeHtml(value)}</dd></div>`
  )).join("");
}

function renderTokens() {
  const sections = [
    ["Color", demo.tokens.color],
    ["Spacing", demo.tokens.spacing],
    ["Typography", demo.tokens.typography],
    ["Radius", demo.tokens.radius]
  ];
  document.querySelector("#tokenGrid").innerHTML = sections.map(([title, tokens]) => (
    `<article class="token-card">
      <h4>${title}</h4>
      ${Object.entries(tokens).map(([name, token]) => tokenRow(name, token)).join("")}
    </article>`
  )).join("");
  document.querySelector("#tokenJson").textContent = JSON.stringify(toStyleDictionary(), null, 2);
}

function tokenRow(name, token) {
  const swatch = token.value.startsWith("#") ? `<span class="swatch" style="background:${token.value}"></span>` : "";
  return `<div class="swatch-row">${swatch}<div><strong>${name}</strong><br><small>${token.css}</small></div></div>`;
}

function renderGeneratedCode() {
  const code = state.framework === "react"
    ? generateReactCode(state.component)
    : state.framework === "vue"
      ? generateVueCode(state.component)
      : generateSvelteCode(state.component);
  generatedCode.textContent = code;
}

function generateReactCode(component) {
  const name = component.name;
  const props = component.props.map((prop) => `${prop}?: string`).join(";\n  ");
  return `import { ${name} as Base${name} } from "${teamPackage.value || "@company/ui"}";

type ${name}Props = {
  ${props};
  children?: React.ReactNode;
};

export function ${name}({ children, ...props }: ${name}Props) {
  return (
    <Base${name}
      {...props}
      data-figma-resource="${component.resource}"
      style={{
        color: "var(--ds-color-ink)",
        background: "var(--ds-color-surface)",
        padding: "${component.spacing}",
        borderRadius: "${component.radius}",
        maxWidth: "100%"
      }}
      aria-label={typeof children === "string" ? children : "${name}"}
    >
      {children}
    </Base${name}>
  );
}`;
}

function generateVueCode(component) {
  return `<script setup lang="ts">
import { ${component.name} as Base${component.name} } from "${teamPackage.value || "@company/ui"}";

defineProps<{
  ${component.props.map((prop) => `${prop}?: string`).join(";\n  ")}
}>();
</script>

<template>
  <Base${component.name}
    data-figma-resource="${component.resource}"
    aria-label="${component.name}"
    :style="{
      color: 'var(--ds-color-ink)',
      background: 'var(--ds-color-surface)',
      padding: '${component.spacing}',
      borderRadius: '${component.radius}',
      maxWidth: '100%'
    }"
  >
    <slot />
  </Base${component.name}>
</template>`;
}

function generateSvelteCode(component) {
  return `<script lang="ts">
  import { ${component.name} as Base${component.name} } from "${teamPackage.value || "@company/ui"}";
  ${component.props.map((prop) => `export let ${prop}: string | undefined = undefined;`).join("\n  ")}
</script>

<Base${component.name}
  data-figma-resource="${component.resource}"
  aria-label="${component.name}"
  style="color: var(--ds-color-ink); background: var(--ds-color-surface); padding: ${component.spacing}; border-radius: ${component.radius}; max-width: 100%;"
>
  <slot />
</Base${component.name}>`;
}

function badSampleFor(component) {
  return `export function ${component.name}() {
  return (
    <div style={{ color: "#ffffff", padding: "13px", borderRadius: "22px" }}>
      ${component.name}
    </div>
  );
}`;
}

function runValidation() {
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
    : "<li><strong>pass</strong>: Implementation follows the demo design contract.</li>";
}

function validateImplementation(code, component) {
  const issues = [];
  const cssVars = Object.values(demo.tokens).flatMap((group) => Object.values(group).map((token) => token.css));
  const rawColors = code.match(/#[0-9a-fA-F]{3,8}/g) || [];
  const pxValues = code.match(/\b\d+(?:\.\d+)?px\b/g) || [];
  const tokenValues = new Set(Object.values(demo.tokens).flatMap((group) => Object.values(group).map((token) => token.value)));

  rawColors.forEach((color) => {
    issues.push({ severity: "error", message: `Raw color ${color} should use a design token.` });
  });
  pxValues.filter((value) => !tokenValues.has(value)).forEach((value) => {
    issues.push({ severity: "warning", message: `${value} is outside the spacing, radius, and type scale.` });
  });
  if (!cssVars.some((token) => code.includes(token))) {
    issues.push({ severity: "warning", message: "No design token references found." });
  }
  if (!/aria-|role=|<button|<Base/.test(code)) {
    issues.push({ severity: "warning", message: "No native semantic element or ARIA attribute found." });
  }
  component.props.forEach((prop) => {
    if (!code.includes(prop)) {
      issues.push({ severity: "info", message: `Prop '${prop}' from the component spec is not represented.` });
    }
  });
  if (!/maxWidth|max-width|width:\s*100%|grid|flex|@media/.test(code)) {
    issues.push({ severity: "info", message: "No responsive layout hint found." });
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

function renderReadiness(readiness) {
  const items = [
    ["Mode", readiness.mode || "demo dashboard"],
    ["Products", (readiness.products || [demo.product]).join(", ")],
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
          FIGMA_FILES_CONFIG: "/absolute/path/to/figma.files.json",
          FIGMA_PRODUCT: "web-app"
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
        component_name: state.component.name,
        framework: state.framework,
        product: "web-app"
      }
    }
  };
  document.querySelector("#mcpPayload").textContent = JSON.stringify(payload, null, 2);
}

function componentResource(component) {
  return {
    uri: component.resource,
    name: component.name,
    variants: component.variants,
    props: component.props,
    spacing: component.spacing,
    radius: component.radius,
    accessibility: component.aria,
    responsive: component.responsive
  };
}

function toStyleDictionary() {
  return Object.fromEntries(Object.entries(demo.tokens).map(([family, tokens]) => [
    family,
    Object.fromEntries(Object.entries(tokens).map(([name, token]) => [
      name,
      { value: token.value, token: token.css }
    ]))
  ]));
}

async function copyText(text, selector) {
  await navigator.clipboard.writeText(text);
  const button = document.querySelector(selector);
  const original = button.textContent;
  button.textContent = "Copied";
  setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function labelForFramework(framework) {
  return framework.charAt(0).toUpperCase() + framework.slice(1);
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
