type ExportPayload = {
  fileName: string;
  exportedAt: string;
  components: Array<{
    id: string;
    name: string;
    description: string;
    variantProperties: Record<string, string>;
  }>;
  variables: Array<{
    id: string;
    name: string;
    resolvedType: string;
    valuesByMode: Record<string, unknown>;
  }>;
};

figma.showUI(__html__, { width: 360, height: 260 });

figma.ui.onmessage = async (message: { type: string; endpoint?: string }) => {
  if (message.type !== "export-design-system") return;
  const payload = await buildExportPayload();
  figma.ui.postMessage({
    type: "export-complete",
    payload,
    componentCount: payload.components.length,
    tokenCount: payload.variables.length
  });

  if (message.endpoint) {
    await fetch(message.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
};

async function buildExportPayload(): Promise<ExportPayload> {
  await figma.loadAllPagesAsync();
  const localComponents = await figma.getLocalComponentsAsync();
  const variableCollections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = (
    await Promise.all(variableCollections.flatMap((collection) => collection.variableIds.map((id) => figma.variables.getVariableByIdAsync(id))))
  )
    .filter((variable): variable is Variable => Boolean(variable))
    .map((variable) => ({
      id: variable.id,
      name: variable.name,
      resolvedType: variable.resolvedType,
      valuesByMode: variable.valuesByMode as Record<string, unknown>
    }));

  return {
    fileName: figma.root.name,
    exportedAt: new Date().toISOString(),
    components: localComponents.map((component) => ({
      id: component.id,
      name: component.name,
      description: component.description,
      variantProperties: component.variantProperties ?? {}
    })),
    variables
  };
}
