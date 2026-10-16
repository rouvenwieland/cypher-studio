/** Farben nur aus docs/tokens.css (DESIGN.md Vertrag „Thema“): in Komponenten-CSS keine Farbwerte, keine Schatten, kein Glas. */
export default {
  rules: {
    "declaration-property-value-disallowed-list": {
      "/.*/": [/#[0-9a-f]{3,8}\b/i, /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(/i],
    },
    "color-named": "never",
    "declaration-no-important": true,
    "property-disallowed-list": ["backdrop-filter", "-webkit-backdrop-filter", "box-shadow", "text-shadow"],
  },
};
