# Scoring And Validation

`validate_implementation` checks whether implementation code respects the Figma component spec.

## Inputs

```json
{
  "component_name": "Button",
  "code": "..."
}
```

The tool loads the component spec, loads design tokens, parses the code, and returns:

```json
{
  "score": 96,
  "issues": [],
  "suggestions": []
}
```

## Extraction

The validator uses TypeScript's compiler API to parse TSX/JSX-like code and extract:

- string literals
- JSX attributes
- ARIA attributes
- CSS-like literal values
- CSS variable references
- color hex values
- `px` spacing values

## Checks

The current scorer checks:

- Figma spacing values are present directly or through matching CSS variables.
- important color tokens are referenced directly or through CSS variables.
- code uses native `<button>` semantics, ARIA attributes, or role attributes.

## Penalties

The score starts at 100:

| Severity | Penalty |
| --- | ---: |
| error | 25 |
| warning | 12 |
| info | 4 |

Scores are clamped between 0 and 100.

## Example

```json
{
  "score": 84,
  "issues": [
    {
      "severity": "warning",
      "path": "Button.spacing",
      "message": "Expected spacing value 8px from Figma spec was not found in implementation.",
      "expected": "8px"
    }
  ],
  "suggestions": [
    "Address Button.spacing: Expected spacing value 8px from Figma spec was not found in implementation."
  ]
}
```

## Roadmap

Future scoring can add visual diffing, actual AST style-object resolution, generated screenshot comparison, and design-system-specific rules.
