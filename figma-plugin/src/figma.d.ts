declare const __html__: string;

type Variable = {
  id: string;
  name: string;
  resolvedType: string;
  valuesByMode: Record<string, unknown>;
};

declare const figma: {
  root: { name: string };
  showUI(html: string, options: { width: number; height: number }): void;
  loadAllPagesAsync(): Promise<void>;
  getLocalComponentsAsync(): Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      variantProperties?: Record<string, string>;
    }>
  >;
  variables: {
    getLocalVariableCollectionsAsync(): Promise<Array<{ variableIds: string[] }>>;
    getVariableByIdAsync(id: string): Promise<Variable | null>;
  };
  ui: {
    onmessage: ((message: { type: string; endpoint?: string }) => void | Promise<void>) | undefined;
    postMessage(message: unknown): void;
  };
};
